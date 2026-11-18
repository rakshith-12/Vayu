"""
Sample Flask application for demonstrating the `flask config` command.
"""
from flask import Flask

app = Flask(__name__)

# Sensitive configuration keys (should be masked as '***')
app.config["SECRET_KEY"] = "super-secret-123"
app.config["API_TOKEN"] = "xyz-jwt-token-999"
app.config["DATABASE_PASSWORD"] = "my_prod_password"
app.config["STRIPE_API_KEY"] = "sk_live_12345"

# Normal configuration keys (should be displayed normally)
app.config["APP_NAME"] = "Task B Demonstration App"
app.config["MAX_CONTENT_LENGTH"] = 16777216
app.config["DEBUG"] = False
