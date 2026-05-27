"""Paso 4: creación de eventos en Google Calendar vía OAuth2."""
import logging
from datetime import datetime, timedelta

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

log = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/calendar"]
TOKEN_URI = "https://oauth2.googleapis.com/token"
TIMEZONE = "America/Bogota"
EVENT_DURATION_MIN = 30


def build_service(client_id: str, client_secret: str, refresh_token: str):
    """Crea el cliente de Calendar usando un refresh token persistente."""
    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        client_id=client_id,
        client_secret=client_secret,
        token_uri=TOKEN_URI,
        scopes=SCOPES,
    )
    creds.refresh(Request())
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def event_exists(service, calendar_id: str, title: str, when: datetime) -> bool:
    """True si ya existe un evento con ese título ese día (evita duplicados)."""
    day_start = when.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    events = (
        service.events()
        .list(
            calendarId=calendar_id,
            timeMin=day_start.isoformat(),
            timeMax=day_end.isoformat(),
            q=title,
            singleEvents=True,
        )
        .execute()
    )
    return any(
        (e.get("summary") or "").strip() == title.strip()
        for e in events.get("items", [])
    )


def create_event(
    service, calendar_id: str, title: str, when: datetime, meet_link: str | None
) -> dict | None:
    """Crea un evento de 30 min. Devuelve None si ya existía (no duplica)."""
    if event_exists(service, calendar_id, title, when):
        return None
    end = when + timedelta(minutes=EVENT_DURATION_MIN)
    body = {
        "summary": title,
        "description": meet_link or "",
        "start": {"dateTime": when.isoformat(), "timeZone": TIMEZONE},
        "end": {"dateTime": end.isoformat(), "timeZone": TIMEZONE},
    }
    return service.events().insert(calendarId=calendar_id, body=body).execute()
