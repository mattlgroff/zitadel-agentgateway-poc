from types import SimpleNamespace

from app.policy.approval import CallerContext, POLICIES, authorize, requires_human


def test_hiring_manager_covers_only_self() -> None:
    caller = CallerContext(sub="ada", org_id="acme", roles=("hiring_manager",))
    assert authorize(caller, "list", None).allowed
    assert authorize(caller, "read", SimpleNamespace(org_id="acme", manager_id="ada", amount=1, hours=1)).allowed
    assert not authorize(caller, "read", SimpleNamespace(org_id="acme", manager_id="grace-team", amount=1, hours=1)).allowed
    assert not authorize(caller, "read", SimpleNamespace(org_id="globex", manager_id="ada", amount=1, hours=1)).allowed


def test_program_office_covers_organization() -> None:
    caller = CallerContext(sub="grace", org_id="acme", roles=("program_office",))
    assert authorize(caller, "list", None).allowed
    assert authorize(caller, "read", SimpleNamespace(org_id="acme", manager_id="ada", amount=1, hours=1)).allowed
    assert not authorize(caller, "read", SimpleNamespace(org_id="globex", manager_id="margaret", amount=1, hours=1)).allowed


def test_viewer_cannot_mutate() -> None:
    caller = CallerContext(sub="linus", org_id="acme", roles=("viewer",))
    assert authorize(caller, "read", None).allowed
    assert not authorize(caller, "approve", None).allowed


def test_mutation_gate_cannot_be_bypassed() -> None:
    caller = CallerContext(sub="ada", org_id="acme", roles=("hiring_manager",))
    row = SimpleNamespace(org_id="acme", manager_id="ada", amount=3400, hours=52)
    gated = authorize(caller, "approve", row, policy=POLICIES["acme"])
    assert gated.error == "requires_human_approval"


def test_operator_is_separate_role() -> None:
    ada = CallerContext(sub="ada", org_id="acme", roles=("hiring_manager",))
    opie = CallerContext(sub="opie", org_id="platform", roles=("operator",))
    assert not authorize(ada, "terminate", None).allowed
    assert authorize(opie, "terminate", None).allowed


def test_threshold_and_hours_are_code_policy() -> None:
    policy = POLICIES["acme"]
    assert not requires_human(policy, 1700, 40)
    assert requires_human(policy, 2400, 40)
    assert requires_human(policy, 1700, 61)
