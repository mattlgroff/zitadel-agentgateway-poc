namespace StackDotnet;

public sealed record Timesheet(
    string Id,
    string OrgId,
    string ManagerId,
    string WorkerName,
    string WeekEnding,
    double Hours,
    decimal Amount,
    string Status,
    string? Note);

public sealed record ToolError(string Error, string Message);

