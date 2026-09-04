from app.agent.history import tool_executions


def test_tool_events_come_from_linked_temporal_activities() -> None:
    history = {
        "events": [
            {
                "eventId": "11",
                "eventTime": "2026-09-03T10:00:00Z",
                "activityTaskScheduledEventAttributes": {
                    "activityType": {"name": "agent__toolset__shared__call_tool"},
                    "inputDecoded": [
                        {
                            "name": "approve_timesheet",
                            "tool_args": {"timesheet_id": "ts-001"},
                            "serialized_run_context": {"tool_call_id": "call_real123"},
                        }
                    ],
                },
            },
            {
                "eventId": "14",
                "eventTime": "2026-09-03T10:00:01Z",
                "activityTaskCompletedEventAttributes": {
                    "scheduledEventId": "11",
                    "resultDecoded": [{"kind": "tool_return", "result": {"id": "ts-001"}}],
                },
            },
        ]
    }
    records = tool_executions(history)
    assert len(records) == 1
    assert records[0].call_id == "call_real123"
    assert records[0].arguments == {"timesheet_id": "ts-001"}
    assert records[0].result == {"id": "ts-001"}
