## What To Do Now

{% case issue.state %}
@states/ready-for-planning.md
@states/planning.md
@states/plan-review.md
@states/ready-for-dev.md
@states/in-dev.md
@states/ready-for-review.md
@states/ready-for-qa.md
@states/in-qa.md
{% else %}
State `{{ issue.state }}` is not dispatchable. Do not modify the workspace. Add a short comment only if the item appears misrouted.
{% endcase %}
