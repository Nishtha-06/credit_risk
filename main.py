# Purpose: Load the credit risk model, predict loan default risk, and serve the frontend.

from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel
import pandas as pd
import joblib
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

# Resolve paths relative to this Python file.
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

ml_model = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the trained model and decision threshold at startup.
    ml_model["model"] = joblib.load(BASE_DIR / "credit_risk_model.pkl")
    ml_model["threshold"] = joblib.load(BASE_DIR / "threshold.pkl")

    yield

    # Release model references when the application shuts down.
    ml_model.clear()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")
# Define the loan application fields accepted by the API.
class LoanApplication(BaseModel):
    person_age: int
    person_income: float
    person_home_ownership: str
    person_emp_length: float
    loan_intent: str
    loan_grade: str
    loan_amnt: float
    loan_int_rate: float
    loan_percent_income: float
    cb_person_default_on_file: str
    cb_person_cred_hist_length: int


# Predict the probability and risk of loan default.
@app.post("/application")
def predict(data: LoanApplication):
    input_df = pd.DataFrame([data.model_dump()])

    probability = float(
        ml_model["model"].predict_proba(input_df)[0, 1]
    )

    threshold = float(ml_model["threshold"])
    prediction = int(probability >= threshold)

    return {
        "default_probability": probability,
        "default_prediction": prediction,
        "threshold": threshold,
        "Risk": "high risk" if prediction == 1 else "low risk",
    }


# Serve the frontend from the static directory.
app.mount(
    "/static",
    StaticFiles(directory=str(STATIC_DIR)),
    name="static",
)
