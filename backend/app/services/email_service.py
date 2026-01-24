from datetime import datetime

class EmailService:
    def send_trade_confirmation(self, trade_details: dict):
        """
        Simulate sending a trade confirmation email.
        In a real app, this would use SMTP or an external provider (SendGrid/AWS SES).
        """
        recipient = "Dinakar.anumolu@zohomail.com"
        subject = f"Trade Confirmation: {trade_details['action']} {trade_details['symbol']}"
        
        # Prepare dynamic content based on action
        pnl_section = ""
        if 'profit_loss' in trade_details and trade_details['action'] == 'SELL':
            pnl = trade_details['profit_loss']
            pnl_color = "GREEN" if pnl >= 0 else "RED"
            pnl_section = f"Profit/Loss: ${pnl:.2f} ({pnl_color})"

        body = f"""
        Dear User,
        
        A trade has been executed on your account.
        
        Transaction Details
        ====================
        Action:        {trade_details['action']}
        Ticker:        {trade_details['symbol']}
        Strike Price:  ${trade_details['price']:.2f}
        Quantity:      {trade_details['amount']}
        Total Value:   ${trade_details['amount'] * trade_details['price']:.2f}
        Date:          {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
        {pnl_section}
        
        Happy Trading!
        """
        
        # SMTP Implementation
        from app.config import settings
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        if not settings.EMAIL_SENDER or not settings.EMAIL_PASSWORD:
            print("Email credentials missing. Logging to file only.")
            self._log_to_file(recipient, subject, body)
            return False

        try:
            msg = MIMEMultipart()
            msg['From'] = settings.EMAIL_FROM
            msg['To'] = recipient
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'plain'))

            server = smtplib.SMTP(settings.SMTP_SERVER, settings.SMTP_PORT)
            server.starttls()
            server.login(settings.EMAIL_SENDER, settings.EMAIL_PASSWORD)
            text = msg.as_string()
            server.sendmail(settings.EMAIL_FROM, recipient, text)
            server.quit()
            print(f"--- REAL EMAIL SENT TO {recipient} ---")
            return True
        except Exception as e:
            print(f"Failed to send real email: {e}")
            self._log_to_file(recipient, subject, body)
            return False

    def _log_to_file(self, recipient, subject, body):
        try:
            with open("emails.txt", "a") as f:
                f.write(f"--- EMAIL LOG (FALLBACK) TO {recipient} ---\n{subject}\n{body}\n-----------------------------------\n\n")
        except Exception as e:
            print(f"Failed to write email to file: {e}")

email_service = EmailService()
