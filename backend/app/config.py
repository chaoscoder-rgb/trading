import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Database
    TURSO_DB_URL: str = ""
    TURSO_AUTH_TOKEN: str = ""
    
    # APIs
    TWELVEDATA_API_KEY: str = "8bd13d536bd24e8aafd154c4506a588a"
    TWELVEDATA_BASE_URL: str = "https://api.twelvedata.com"
    FINNHUB_API_KEY: str = "d5qgtjhr01qhn30fkergd5qgtjhr01qhn30fkes0"
    FINNHUB_BASE_URL: str = "https://finnhub.io/api/v1"
    
    # FRED (Macro Data)
    FRED_API_KEY: str = "8fbad145b14c1b198d6026d570401ed4"
    FRED_BASE_URL: str = "https://api.stlouisfed.org/fred"

    # KALSHI
    KALSHI_API_KEY: str = "4fe64e48-3b5a-4809-bfe7-d31896b85e25"
    KALSHI_BASE_URL: str = "https://trading-api.kalshi.com/trade-api/v2"
    KALSHI_RSA_PRIVATE_KEY: str = """-----BEGIN PRIVATE KEY-----
MIIEpAIBAAKCAQEApp8HOOj4HwRy+Z7MinZUql7xOJq3IhthMoaZvB5hdT1foBkj
Vzu5TsPAHoXnpsVmUHh1K2dQ7HDBElU36GuSjOavZK/UOxxDeRQpFuagF7uQz8CX
tWqjKiA+yd+ykgTDwADhgQSedNelhmkGJyAcCWonIzkLne7Y4E68763f4mfTwQCJ
/E7MUJRmrVshUIOuD8DYas1eAJ4GE/QJS//SL0r2vSK82tcUeK2XyUEPq72hA88M
dcnCP+SEE23wjFSPkkfdPZ4P7HGey5SZ+3EHcQ2snM4OwOkiAPG0JqNPIK80pNoU
4K7fPzhZuL1Lo7exi6A8KyZMYP1LeKmwTaKgfQIDAQABAoIBAAJGpQacYadEaRc+
M0HahyJWO0OwRiG4VgXzdYe7f04Z3h1Sh2HadjGJPJQuKBF/6MhFacEdOPgoO7rp
+ki5qQrO3xGoOGUf6BwJsA+Y0hI0Hn13/mdP/Mj6hi3W8s19Z/i1Cl+EyW7qWZLe
15XfoZwCgzGL+e8L8CwNAOLiCrwNwV+Wups9se0+R6QoOtesNcTe3iKrwRDYXSHY
nQZrGFZP55db3x+5YT1Izsa3Iyxk+LoGgi5hObO6SZdoOEKWYGnRVCsAgw04Fjyf
COz9mFij1uwIhoR6f69ArPJj+5v+O2umNB1tdzEV0ma6GJDXAVg7UCpKNs7I++pD
NbCwatECgYEAylDhpyhUU1rumwPbS9y0M/0ZoA5GdVEovWo7aMmGYuKa5H9VLiJw
w1/wZf+cNlok7DkYOoFysoiV9SRtE6Q6wVbgvUq+lTtGKkPVhBHFOL92zLnzT4As
makoP1Xx191gL2zhwYzRLib4Mpo3uGs5uhOLoT3muW2OHkoHmuWurf8CgYEA0tVw
Y4XhM7ch/yBFUxP+4PER4paNnmQCyb8vOhD3ngZibfZZi2d/b3K/sZS1AmdJ6mIn
UZYGgkn0gEPRmfzaCL44zUQfaB+vnUdTWO/QQgs3Xx8uNQOXbJ4lmIrhKmazKb4G
k7gTRuZRABIGk/uIGCxlenCSTkLhBVyjeEQeaYMCgYEAru5ETl5Gm1Qyn4I0KWIJ
xjH/6C6vqVylVzH1cGNfeTzqJMwcgKlyytu3Ztoe3bgP2Nh9JIks/UWwM6htT+Be
lTFjXQi1xR7dSkog4fLjjm+ubtIRmRoAdlSW4jyTwcw+EIOap9n0PG2hiU9jAmhk
H4oq3x5A0u/xRCtKbBpQcU0CgYEAxI9RVLgAmWJnQ6AmganmuniGICYUqlK7drPT
p+MhuCZjpflCyoEXgiQNK9ZkW3VIqEgSODISp22jkeGojFP8QqJ1+olEbqL76zoQ
Lp6GHsyuNvSu86YBirZ2fp0cB5fv+T68iwPWlQctBU/I6jZbT440nc5N2MDpYUJY
9Ussv1kCgYBcpp90Vv5/M6HsxTVjg8s7b+41Fo4s9HVnBIzovdbmoKsupooKcVD+
KKt82dmL3GxdOKnMQ+s3AJxJYH53tgmywHhZ7mDRfuRD8STVCvPkdPI5eCejm4US
kYUiuC4SPMoBrHPNiRHyha+lUQHluKayze6ldvigQQy2xeR1Jm/ctQ==
-----END PRIVATE KEY-----"""

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
