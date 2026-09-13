"""
Script to reset ALL user passwords to a specific value.
Usage: python backend/scripts/reset_all_passwords.py <new_password>
"""
import os
import sys
from pathlib import Path
from sqlalchemy import create_engine, text
from passlib.context import CryptContext
from dotenv import load_dotenv

# Setup paths
current_dir = Path(__file__).resolve().parent
backend_dir = current_dir.parent
env_path = backend_dir / '.env'

# Load env vars
load_dotenv(env_path)

# Setup password hashing (bcrypt)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def reset_all_passwords(new_password: str):
    # Determine DB URL
    db_url = os.getenv("DATABASE_URL")
    
    # Fallback to local SQLite if no env var
    if not db_url:
        # Check root of backend first (common location)
        sqlite_path = backend_dir / 'westernpumps.db'
        if not sqlite_path.exists():
            # Check devdata as fallback
            sqlite_path = backend_dir / 'devdata' / 'westernpumps.db'
        
        db_url = os.getenv('DATABASE_URL') or f"sqlite:///{sqlite_path.resolve().as_posix()}"
        print(f"No DATABASE_URL found in .env, using local SQLite: {sqlite_path}")
    else:
        print(f"Using database configured in .env")

    try:
        # Create engine and connect
        engine = create_engine(db_url)
        hashed_password = get_password_hash(new_password)
        
        with engine.begin() as connection:
            result = connection.execute(text("UPDATE users SET password_hash = :pwd"), {"pwd": hashed_password})
            print(f"Success! Updated password for {result.rowcount} users.")
            
    except Exception as e:
        print(f"Error updating database: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python reset_all_passwords.py <new_password>")
        print("ERROR: new_password argument is required (no default for safety).")
        sys.exit(1)
    target_password = sys.argv[1]
    print(f"Resetting ALL user passwords...")
    reset_all_passwords(target_password)
