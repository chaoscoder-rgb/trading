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
