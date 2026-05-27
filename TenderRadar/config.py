"""Carga de configuración desde variables de entorno (.env)."""
import os
from dataclasses import dataclass

from dotenv import load_dotenv

# override=True: el .env manda sobre variables de entorno del sistema que
# pudieran quedar viejas (p. ej. una ANTHROPIC_API_KEY revocada en el perfil).
load_dotenv(override=True)


@dataclass
class Config:
    google_client_id: str
    google_client_secret: str
    google_refresh_token: str
    google_calendar_id: str
    slack_webhook_url: str
    slack_channel: str
    slack_webhook_url_pliegos: str
    slack_channel_pliegos: str
    anthropic_api_key: str
    download_folder: str
    pliegos_folder: str
    state_file: str

    def validate(self) -> list[str]:
        """Variables obligatorias para el flujo SEMANAL de audiencias."""
        missing = []
        if not self.google_client_id:
            missing.append("GOOGLE_CLIENT_ID")
        if not self.google_client_secret:
            missing.append("GOOGLE_CLIENT_SECRET")
        if not self.google_refresh_token:
            missing.append("GOOGLE_REFRESH_TOKEN")
        if not self.slack_webhook_url:
            missing.append("SLACK_WEBHOOK_URL")
        return missing

    def validate_daily(self) -> list[str]:
        """Variables obligatorias para el flujo DIARIO de pliegos."""
        missing = []
        if not self.slack_webhook_url_pliegos:
            missing.append("SLACK_WEBHOOK_URL_PLIEGOS")
        if not self.anthropic_api_key:
            missing.append("ANTHROPIC_API_KEY")
        return missing


def load_config() -> Config:
    return Config(
        google_client_id=os.environ.get("GOOGLE_CLIENT_ID", "").strip(),
        google_client_secret=os.environ.get("GOOGLE_CLIENT_SECRET", "").strip(),
        google_refresh_token=os.environ.get("GOOGLE_REFRESH_TOKEN", "").strip(),
        google_calendar_id=os.environ.get("GOOGLE_CALENDAR_ID", "primary").strip(),
        slack_webhook_url=os.environ.get("SLACK_WEBHOOK_URL", "").strip(),
        slack_channel=os.environ.get("SLACK_CHANNEL", "").strip(),
        slack_webhook_url_pliegos=os.environ.get("SLACK_WEBHOOK_URL_PLIEGOS", "").strip(),
        slack_channel_pliegos=os.environ.get("SLACK_CHANNEL_PLIEGOS", "").strip(),
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", "").strip(),
        download_folder=os.environ.get("DOWNLOAD_FOLDER", "./descargas_sicep").strip(),
        pliegos_folder=os.environ.get("PLIEGOS_FOLDER", "./descargas_pliegos").strip(),
        state_file=os.environ.get("STATE_FILE", "./estado_pliegos.json").strip(),
    )
