
import bcrypt
import sys

def generate_hash(password):
    """Generates a bcrypt hash for the given password."""
    # Generate a salt. The 'rounds' parameter controls the complexity.
    # Higher rounds mean more secure but slower hashing. Default is 12.
    salt = bcrypt.gensalt(rounds=12)
    
    # Hash the password using the generated salt
    hashed_password = bcrypt.hashpw(password.encode('utf-8'), salt)
    
    return hashed_password.decode('utf-8')

if __name__ == "__main__":
    if len(sys.argv) > 1:
        password_to_hash = sys.argv[1]
    else:
        password_to_hash = "password"

    if password_to_hash:
        bcrypt_hash = generate_hash(password_to_hash)
        print(f"Bcrypt Hash: {bcrypt_hash}")
    else:
        print("No password entered. Exiting.")
