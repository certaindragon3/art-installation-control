# Polling System Payloads

Payloads for controlling the current polling/voting system from Unity, curl, Postman, or any HTTP client.

In this codebase, the polling system is called `vote` internally.

## Base Endpoint

```http
POST /api/controller/command
Content-Type: application/json
```

Example base URL:

```bash
BASE_URL="https://artinstallation.certaindragon3.work"
```

## 1. List Receivers

Use this first to find valid `receiverId` values.

```bash
curl "$BASE_URL/api/controller/receivers"
```

Use `targetId: "*"` to broadcast a poll to all receivers.

Use `targetId: "screen-a"` to target one receiver.

## 2. Start A Poll

This opens a poll on all receivers.

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_vote_state",
    "targetId": "*",
    "payload": {
      "vote": {
        "voteId": "poll_001",
        "question": "Which rule should be active next?",
        "options": [
          { "id": "rule_a", "label": "Rule A" },
          { "id": "rule_b", "label": "Rule B" },
          { "id": "rule_c", "label": "Rule C" }
        ],
        "visible": true,
        "enabled": true,
        "visibilityDuration": 30,
        "allowRevote": true,
        "selectedOptionId": null,
        "submittedAt": null
      }
    }
  }'
```

Important fields:

- `voteId`: unique poll ID.
- `question`: text shown to receivers.
- `options`: poll buttons.
- `visibilityDuration`: seconds before auto-close. Use `0` for no auto-close.
- `allowRevote`: if `true`, users can change their answer before the poll closes.
- `targetId`: use `"*"` for all receivers or one receiver ID.

## 3. Shorter Payload Also Accepted

The API also accepts these convenience aliases:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_vote_state",
    "targetId": "*",
    "payload": {
      "vote": {
        "voteId": "poll_002",
        "voteQuestion": "Choose the next scene",
        "voteOptions": ["Scene A", "Scene B", "Scene C"],
        "voteVisible": true,
        "voteEnabled": true,
        "visibilityDuration": 20,
        "voteAllowRevote": false
      }
    }
  }'
```

With string options, option IDs are generated as:

- `option_1`
- `option_2`
- `option_3`

## 4. Close Or Hide Current Poll

Hide the poll from targeted receivers but keep the session exportable.

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_vote_state",
    "targetId": "*",
    "payload": {
      "vote": {
        "voteId": "poll_001",
        "question": "Which rule should be active next?",
        "options": [
          { "id": "rule_a", "label": "Rule A" },
          { "id": "rule_b", "label": "Rule B" },
          { "id": "rule_c", "label": "Rule C" }
        ],
        "visible": false,
        "enabled": true,
        "visibilityDuration": 30,
        "allowRevote": true,
        "selectedOptionId": null,
        "submittedAt": null
      }
    }
  }'
```

## 5. Clear Poll UI Completely

This removes the current poll config from targeted receivers.

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_vote_state",
    "targetId": "*",
    "payload": {
      "vote": null
    }
  }'
```

## 6. Reset All Current Votes

This keeps the active poll open but clears current selections.

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "vote_reset_all",
    "targetId": "*",
    "payload": {}
  }'
```

## 7. Export Poll Results

```bash
curl "$BASE_URL/api/controller/votes/export"
```

Response shape:

```json
{
  "ok": true,
  "votes": [
    {
      "voteId": "poll_001",
      "question": "Which rule should be active next?",
      "options": [
        { "optionId": "rule_a", "label": "Rule A", "voteCount": 2 },
        { "optionId": "rule_b", "label": "Rule B", "voteCount": 1 }
      ],
      "allowRevote": true,
      "visibilityDuration": 30,
      "openedAt": "2026-04-13T10:00:00.000Z",
      "closesAt": "2026-04-13T10:00:30.000Z",
      "closedAt": "2026-04-13T10:00:30.000Z",
      "closeReason": "timeout",
      "isActive": false,
      "submittedCount": 3,
      "totalEligible": 4,
      "missingReceiverIds": ["screen-d"],
      "eligibleReceivers": [
        {
          "receiverId": "screen-a",
          "label": "Screen A",
          "connected": true,
          "hasVoted": true
        }
      ]
    }
  ]
}
```

## 8. Realtime Unity Result Event

If Unity registers as a Socket.IO `unity` client, it receives this event when a poll closes:

```json
{
  "sourceRole": "controller",
  "receiverId": null,
  "action": "voteResults",
  "element": "vote:results",
  "value": {
    "voteId": "poll_001",
    "submittedCount": 3,
    "totalEligible": 4,
    "missingReceiverIds": ["screen-d"],
    "options": [
      { "optionId": "rule_a", "label": "Rule A", "voteCount": 2 },
      { "optionId": "rule_b", "label": "Rule B", "voteCount": 1 }
    ]
  },
  "timestamp": "2026-04-13T10:00:30.000Z"
}
```

## 9. Notes

- Receiver pages submit votes through Socket.IO using `submit_vote`.
- Unity usually does not need to submit votes directly.
- While a poll is visible on a receiver, the receiver UI locks other interactions until the poll closes.
- Results are stored in server memory, so deployment must stay single-replica.
