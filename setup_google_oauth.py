"""Helper de una sola vez para obtener el GOOGLE_REFRESH_TOKEN.

Uso:
    python setup_google_oauth.py

Abre el navegador, pide autorización y muestra el refresh token para
pegarlo en el archivo .env.
"""
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/calendar"]


def main() -> None:
    print("=== Configuración OAuth de Google - SICEP Audiencias ===\n")
    client_id = input("GOOGLE_CLIENT_ID: ").strip()
    client_secret = input("GOOGLE_CLIENT_SECRET: ").strip()

    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    # access_type=offline + prompt=consent garantiza que venga el refresh token.
    creds = flow.run_local_server(
        port=0, access_type="offline", prompt="consent"
    )

    if not creds.refresh_token:
        print("\n[ERROR] No se obtuvo refresh token. Revoca el acceso de la app en")
        print("https://myaccount.google.com/permissions y vuelve a intentarlo.")
        return

    print("\n=== Refresh token obtenido correctamente ===")
    print(f"\nGOOGLE_REFRESH_TOKEN={creds.refresh_token}\n")
    print("Copia esa línea (el valor) en tu archivo .env.")


if __name__ == "__main__":
    main()
