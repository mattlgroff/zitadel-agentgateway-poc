import { approveTimesheet } from "./approve-timesheet.js";
import { getApprovalDetail } from "./get-approval-detail.js";
import { listMyPendingApprovals } from "./list-my-pending-approvals.js";
import { rejectTimesheet } from "./reject-timesheet.js";
import { whatIsRequired } from "./what-is-required.js";

export const tools = {
  what_is_required: whatIsRequired,
  list_my_pending_approvals: listMyPendingApprovals,
  get_approval_detail: getApprovalDetail,
  approve_timesheet: approveTimesheet,
  reject_timesheet: rejectTimesheet,
};
