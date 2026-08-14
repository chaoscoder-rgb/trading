import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Database
    TURSO_DB_URL: str = ""
    TURSO_AUTH_TOKEN: str = ""
    
    # APIs
    # Massive (massive.com, formerly Polygon.io) — key lives in .env on the
    # server only; never hardcode it here (public repo).
    MASSIVE_API_KEY: str = ""
    MASSIVE_BASE_URL: str = "https://api.massive.com"
    FINNHUB_API_KEY: str = ""
    FINNHUB_BASE_URL: str = "https://finnhub.io/api/v1"

    # FRED (Macro Data)
    FRED_API_KEY: str = ""
    FRED_BASE_URL: str = "https://api.stlouisfed.org/fred"

    # KALSHI — key material comes from the server-side .env ONLY.
    # KALSHI_RSA_PRIVATE_KEY accepts either a full PEM (with \n escapes) or
    # base64 of the PEM file (easier to put in an env var):
    #   base64 -w0 kalshi-key.pem   ->  KALSHI_RSA_PRIVATE_KEY=<output>
    KALSHI_API_KEY: str = ""
    KALSHI_BASE_URL: str = "https://external-api.kalshi.com/trade-api/v2"
    KALSHI_RSA_PRIVATE_KEY: str = ""

    # Goldprice.dev — free metals prices (gold/silver/copper). Anonymous
    # access works for the core price row; a free key lifts rate limits.
    GOLDPRICE_API_KEY: str = ""
    GOLDPRICE_BASE_URL: str = "https://api.goldprice.dev"

    # Fundamentals pillar — World Bank + US Treasury need NO key.
    WORLDBANK_BASE_URL: str = "https://api.worldbank.org/v2"
    TREASURY_FISCAL_BASE_URL: str = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
    # Econdb — optional free token (register at econdb.com) for US
    # industrial production; pillar works without it.
    ECONDB_API_TOKEN: str = ""
    ECONDB_BASE_URL: str = "https://www.econdb.com/api"

    # Sentiment — Tradestie WSB is keyless; MarketAux needs a free token.
    TRADESTIE_BASE_URL: str = "https://api.tradestie.com/v1"
    MARKETAUX_API_TOKEN: str = ""
    MARKETAUX_BASE_URL: str = "https://api.marketaux.com/v1"

    # Email
    EMAIL_SENDER: str = ""
    EMAIL_PASSWORD: str = ""
    EMAIL_FROM: str = ""
    SMTP_SERVER: str = ""
    SMTP_PORT: int = 587
    
    # App
    LOG_LEVEL: str = "info"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding='utf-8',
        extra='ignore'
    )

settings = Settings()
