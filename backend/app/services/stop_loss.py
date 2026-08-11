import json
import asyncio
from datetime import datetime

DEFAULT_SETTINGS = {
    "enabled": True,
    "default_pct": 10.0,        # spec: default 10%, range 1-50
    "auto_execute": False,      # spec: manual-confirmation mode by default
    "pre_warning_ratio": 0.8,   # warn at 80% of the stop (8% for a 10% stop)
    "check_interval_sec": 300,  # monitor cadence
}


class StopLossService:
    """
    Phase 1.1-1.2 stop-loss framework (per TradingRequirementsPrompt):
    - percentage-based stops: global default + per-position override
    - background monitor with pre-trigger warnings and trigger alerts
    - manual (alert-only) or auto-execute (paper sell) modes
    - trigger log in stop_loss_triggers, in-app alerts + email
    """

    def __init__(self):
        self._task = None

    # ------------------------------------------------------------- settings

    async def get_settings(self, db) -> dict:
        try:
            rs = await db.execute("SELECT value FROM settings WHERE key = 'stop_loss'")
            if rs.rows:
                saved = json.loads(rs.rows[0][0])
                return {**DEFAULT_SETTINGS, **saved}
        except Exception as e:
            print(f"Error reading stop-loss settings: {e}")
        return dict(DEFAULT_SETTINGS)

    async def save_settings(self, db, updates: dict) -> dict:
        current = await self.get_settings(db)
        merged = {**current, **{k: v for k, v in updates.items() if k in DEFAULT_SETTINGS}}
        # Clamp to the spec's ranges
        merged["default_pct"] = min(50.0, max(1.0, float(merged["default_pct"])))
        merged["pre_warning_ratio"] = min(0.95, max(0.1, float(merged["pre_warning_ratio"])))
        merged["check_interval_sec"] = max(60, int(merged["check_interval_sec"]))
        await db.execute(
            "INSERT INTO settings (key, value) VALUES ('stop_loss', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [json.dumps(merged)],
        )
        return merged

    # ------------------------------------------------- pure decision logic

    @staticmethod
    def evaluate(pnl_pct: float, stop_pct: float, state: str, warn_ratio: float) -> tuple:
        """
        Decide what to do for one position. Pure function (unit-testable).

        Returns (new_state, action) where action is one of
        None | 'warn' | 'trigger' | 'reset'.
        """
        state = state or "active"
        if state == "triggered":
            return state, None  # nothing more to do until position changes

        EPS = 1e-9  # float-boundary tolerance (e.g. 12 * 0.8 == 9.600000000000001)
        warn_level = -stop_pct * warn_ratio
        trigger_level = -stop_pct

        if pnl_pct <= trigger_level + EPS:
            return "triggered", "trigger"
        if pnl_pct <= warn_level + EPS:
            return ("warned", "warn") if state == "active" else ("warned", None)
        # recovered above the warning band -> re-arm
        if state == "warned":
            return "active", "reset"
        return "active", None

    # ------------------------------------------------------------- monitor

    async def check_positions(self, db) -> list:
        """One monitoring pass. Returns a list of actions taken (for tests/API)."""
        from app.services.data_engine import data_engine
        from app.services.email_service import email_service

        settings = await self.get_settings(db)
        if not settings["enabled"]:
            return []

        rs = await db.execute(
            "SELECT id, symbol, quantity, avg_price, stop_loss_pct, stop_state FROM holdings"
        )
        actions = []
        for row in rs.rows:
            hid, symbol, qty, avg_price, override_pct, state = row
            if not avg_price:
                continue
            try:
                data = await data_engine.get_price(symbol)
                price = float(data.get("price") or 0)
                if price <= 0:
                    continue

                pnl_pct = (price - avg_price) / avg_price * 100
                stop_pct = float(override_pct) if override_pct else float(settings["default_pct"])
                new_state, action = self.evaluate(
                    pnl_pct, stop_pct, state, float(settings["pre_warning_ratio"])
                )

                if new_state != state:
                    await db.execute(
                        "UPDATE holdings SET stop_state = ? WHERE id = ?", [new_state, hid]
                    )

                if action == "warn":
                    msg = (f"{symbol} position down {abs(pnl_pct):.1f}% — "
                           f"approaching {stop_pct:.0f}% stop loss "
                           f"(entry ${avg_price:.2f}, now ${price:.2f})")
                    await self._add_alert(db, "warning", symbol, msg)
                    actions.append(("warn", symbol))

                elif action == "trigger":
                    mode = "AUTO_SELL" if settings["auto_execute"] else "ALERT_ONLY"
                    msg = (f"⚠️ STOP LOSS TRIGGERED: {symbol} down {abs(pnl_pct):.1f}% "
                           f"(stop {stop_pct:.0f}%). Entry ${avg_price:.2f}, now ${price:.2f}. "
                           f"Action: {'auto-sell executed' if mode == 'AUTO_SELL' else 'manual review required'}")
                    await self._add_alert(db, "trigger", symbol, msg)
                    await self._log_trigger(db, hid, symbol, price, pnl_pct, mode, data)
                    try:
                        email_service.send_stop_loss_alert(symbol, avg_price, price, pnl_pct, stop_pct, mode)
                    except Exception as e:
                        print(f"Stop-loss email failed: {e}")
                    if mode == "AUTO_SELL":
                        await self._auto_sell(db, hid, symbol, qty, price, avg_price)
                    actions.append(("trigger", symbol))

            except Exception as e:
                print(f"Stop-loss check failed for {symbol}: {e}")
        return actions

    async def _add_alert(self, db, alert_type: str, symbol: str, message: str):
        await db.execute(
            "INSERT INTO alerts (type, symbol, message, created_at, read) VALUES (?, ?, ?, ?, 0)",
            [alert_type, symbol, message, datetime.utcnow()],
        )

    async def _log_trigger(self, db, position_id, symbol, price, pnl_pct, action, price_data):
        market_conditions = json.dumps({
            "source": price_data.get("source"),
            "note": price_data.get("message"),
            "change_percent": price_data.get("change_percent"),
        })
        await db.execute(
            """INSERT INTO stop_loss_triggers
               (position_id, symbol, trigger_price, loss_percentage, triggered_at,
                action_taken, market_conditions)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [position_id, symbol, price, round(pnl_pct, 2), datetime.utcnow(),
             action, market_conditions],
        )

    async def _auto_sell(self, db, holding_id, symbol, qty, price, cost_basis):
        """Close the paper position entirely (spec: auto-execute mode)."""
        timestamp = datetime.utcnow()
        await db.execute(
            """INSERT INTO trades (commodity_symbol, type, price, amount, cost_basis,
                                   timestamp, is_paper)
               VALUES (?, 'SELL', ?, ?, ?, ?, 1)""",
            [symbol, price, qty, cost_basis, timestamp],
        )
        await db.execute("DELETE FROM holdings WHERE id = ?", [holding_id])

    async def monitor_loop(self):
        """Background task started at app startup."""
        from app.db import get_db
        await asyncio.sleep(10)  # let the app finish booting
        while True:
            interval = DEFAULT_SETTINGS["check_interval_sec"]
            try:
                async for db in get_db():
                    settings = await self.get_settings(db)
                    interval = settings["check_interval_sec"]
                    if settings["enabled"]:
                        actions = await self.check_positions(db)
                        if actions:
                            print(f"Stop-loss monitor: {actions}")
                    break
            except Exception as e:
                print(f"Stop-loss monitor pass failed: {e}")
            await asyncio.sleep(interval)

    def start(self):
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self.monitor_loop())


stop_loss_service = StopLossService()
