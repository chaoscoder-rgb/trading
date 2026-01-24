import libsql_client
import inspect

print("Inspecting libsql_client...")
print(f"Dir: {dir(libsql_client)}")

has_sync = "create_client_sync" in dir(libsql_client)
print(f"Has create_client_sync: {has_sync}")

if has_sync:
    from app.config import settings
    url = settings.TURSO_DB_URL.replace("libsql://", "https://")
    token = settings.TURSO_AUTH_TOKEN
    
    print("Testing Sync Connection...")
    try:
        client = libsql_client.create_client_sync(url, auth_token=token)
        print("Client created.")
        rs = client.execute("SELECT 1")
        print(f"Result: {rs.rows}")
        client.close()
        print("Success!")
    except Exception as e:
        print(f"Sync Failed: {e}")
