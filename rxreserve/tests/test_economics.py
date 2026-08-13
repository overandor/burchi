import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.economics import (
    EmployeeBalanceSheet,
    CompanyBalanceSheet,
    HumanResidual,
    AutomationDividend,
    StateVector,
)


# ─── EmployeeBalanceSheet ───

def test_employee_balance_sheet_total_assets_default_zero():
    bs = EmployeeBalanceSheet(employee_id="emp-1")
    assert bs.total_assets == 0.0
    assert bs.total_liabilities == 0.0
    assert bs.net_economic_position == 0.0


def test_employee_balance_sheet_total_assets_components():
    bs = EmployeeBalanceSheet(
        employee_id="emp-1",
        verified_value_created=500_000.0,
        information_value=100_000.0,
        reusable_primitives=["p1", "p2", "p3"],
        owned_systems=["sys-a"],
    )
    # 500k + 100k + 3*100k + 1*50k = 950k
    assert bs.total_assets == 950_000.0


def test_employee_balance_sheet_total_liabilities_components():
    bs = EmployeeBalanceSheet(
        employee_id="emp-1",
        unsettled_recognition_debt=50_000.0,
        automatable_work_hours=10.0,    # 10 * 200 = 2000
        invisible_labor_hours=4.0,      # 4 * 150 = 600
        low_scope_execution=1.0,        # 1 * 100k = 100k
        political_concentration=0.5,    # 0.5 * 200k = 100k
    )
    # 50k + 2k + 600 + 100k + 100k = 252600
    assert bs.total_liabilities == 252_600.0


def test_employee_balance_sheet_net_economic_position():
    bs = EmployeeBalanceSheet(
        employee_id="emp-1",
        verified_value_created=1_000_000.0,
        unsettled_recognition_debt=200_000.0,
    )
    assert bs.net_economic_position == 800_000.0


def test_employee_balance_sheet_to_dict():
    bs = EmployeeBalanceSheet(
        employee_id="emp-1",
        verified_value_created=100_000.0,
        reusable_primitives=["p1"],
    )
    d = bs.to_dict()
    assert d["employee_id"] == "emp-1"
    assert d["total_assets"] == 200_000.0  # 100k + 1*100k
    assert d["total_liabilities"] == 0.0
    assert d["net_economic_position"] == 200_000.0
    assert "assets" in d and "liabilities" in d and "options" in d
    assert d["assets"]["reusable_primitives"] == ["p1"]


# ─── CompanyBalanceSheet ───

def test_company_balance_sheet_to_dict_structure():
    cbs = CompanyBalanceSheet(
        hidden_capabilities=[{"capability": "ml pipeline", "owner": "emp-2"}],
        underutilized_employees=["emp-3", "emp-4"],
        automation_exposure=0.3,
        recognition_debt_total=250_000.0,
        succession_gaps=["CTO"],
    )
    d = cbs.to_dict()
    assert "hidden_assets" in d
    assert "hidden_liabilities" in d
    assert d["hidden_assets"]["underutilized_employees"] == ["emp-3", "emp-4"]
    assert d["hidden_liabilities"]["automation_exposure"] == 0.3
    assert d["hidden_liabilities"]["recognition_debt_total"] == 250_000.0
    assert d["hidden_liabilities"]["succession_gaps"] == ["CTO"]


# ─── HumanResidual ───

def test_human_residual_ratio_zero_when_no_time():
    hr = HumanResidual(employee_id="emp-1", residual_hours=10.0)
    assert hr.residual_ratio == 0.0


def test_human_residual_ratio():
    hr = HumanResidual(
        employee_id="emp-1",
        total_employee_time_hours=40.0,
        residual_hours=10.0,
    )
    assert hr.residual_ratio == 0.25


def test_human_residual_value_density():
    hr = HumanResidual(
        employee_id="emp-1",
        residual_hours=10.0,
        judgments_ai_cannot_make=["j1", "j2"],
        relationships_required=["r1"],
        novel_problems_solved=["n1", "n2", "n3"],
    )
    # 2 + 1 + 3 = 6
    assert hr.residual_value_density == 6


def test_human_residual_to_dict():
    hr = HumanResidual(
        employee_id="emp-1",
        total_employee_time_hours=40.0,
        automatable_hours=15.0,
        augmentable_hours=10.0,
        residual_hours=15.0,
        judgments_ai_cannot_make=["j1"],
    )
    d = hr.to_dict()
    assert d["employee_id"] == "emp-1"
    assert d["residual_ratio"] == 0.375
    assert d["residual_value_density"] == 1
    assert d["automatable_hours"] == 15.0


# ─── AutomationDividend ───

def test_automation_dividend_value():
    ad = AutomationDividend(
        employee_id="emp-1",
        displaced_work_value=50_000.0,
        new_work_value=150_000.0,
    )
    assert ad.dividend == 100_000.0


def test_automation_dividend_negative():
    ad = AutomationDividend(
        displaced_work_value=200_000.0,
        new_work_value=100_000.0,
    )
    assert ad.dividend == -100_000.0


def test_automation_dividend_to_dict():
    ad = AutomationDividend(
        employee_id="emp-1",
        displaced_work_description="data entry",
        new_higher_order_work="pipeline ownership",
        career_path=["execution", "supervise", "own"],
        current_stage=1,
    )
    d = ad.to_dict()
    assert d["employee_id"] == "emp-1"
    assert d["career_path"] == ["execution", "supervise", "own"]
    assert d["current_stage"] == 1
    assert d["dividend"] == 0.0
    assert d["dividend_id"].startswith("DIV-")


# ─── StateVector ───

def test_state_vector_as_vector_length():
    sv = StateVector(employee_id="emp-1", V=10.0, I=5.0, P=3)
    vec = sv.as_vector()
    assert len(vec) == 12
    assert vec[0] == 10.0
    assert vec[3] == 5.0
    assert vec[5] == 3.0


def test_state_vector_to_dict():
    sv = StateVector(
        employee_id="emp-1",
        V=100.0,
        V_dot=10.0,
        I=50.0,
        P=2,
        P_value=200_000.0,
        R=0.3,
    )
    d = sv.to_dict()
    assert d["employee_id"] == "emp-1"
    assert d["V"] == 100.0
    assert d["P"] == 2
    assert d["P_value"] == 200_000.0
    assert d["R"] == 0.3
    assert len(d["vector"]) == 12
    assert d["vector"][0] == 100.0
