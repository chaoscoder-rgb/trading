import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Database
    TURSO_DB_URL: str = ""
    TURSO_AUTH_TOKEN: str = ""
    
    # APIs
    TWELVEDATA_API_KEY: str = ""
    TWELVEDATA_BASE_URL: str = "https://api.twelvedata.com"
    FINNHUB_API_KEY: str = ""
    FINNHUB_BASE_URL: str = "https://finnhub.io/api/v1"
    
    # FRED (Macro Data)
    FRED_API_KEY: str = ""
    FRED_BASE_URL: str = "https://api.stlouisfed.org/fred"

    # KALSHI
    KALSHI_API_KEY: str = "4fe64e48-3b5a-4809-bfe7-d31896b85e25"
    KALSHI_BASE_URL: str = "https://trading-api.kalshi.com/trade-api/v2"
    
    # Email
    EMAIL_SENDER: str = ""
    EMAIL_PASSWORD: str = ""
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
