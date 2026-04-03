# Web UI Requirements for Student Interface

Json should expire after 1 minute

Every interactive element should have a postToUnity function embedded.

For “continuous” values (such as volume control) only startInteraction/endInteraction are sent (with start/ end value. endInteraction also gives interactionDuration)

# 0. Networking / Data Posting (Global Requirement)

 It would be great if single user sessions could post to Unity, instead of requiring manual download.   
 A button press is transient (lost after being pressed unless stored).   
Some actions are difficult to compute post-hoc.   
 Ideally:

o Each user session posts directly to Unity.   
o Every single “play” hit is sent.

 Possible approach:

o Web socket

 If not feasible, some mechanics may need to be reconsidered.

# 1. Audio Playback

# 1.1 Track Looping

# Requirements

 Automatic loop on tracks should be off by default.   
 Looping should remain exposed as a controllable state.   
Each track should have a loop button:

o Can be activated/deactivated by the user   
o Unless locked by the system

# Possible Keys

```json
{
    "trackId": "track_01",
    "loopEnabled": false,
    "loopControlVisible": true,
    "loopControlLocked": false
} 
```

# 1.2 Pulse / Tempo

# Requirements

 A regular pulse should be available.   
 Pulse is a message broadcast at regular intervals (single character is sufficient).   
 Preferably handled server-side, not from Unity (to avoid accumulated delay).   
 BPM must be configurable.   
 Pulse can be active/inactive.

# Possible Keys

```txt
{ "pulseEnabled": true, "pulseBpm": 90 } 
```

# 1.3 Track Groups / Sample Groups

# Requirements

 Tracks must be assignable to groups of samples.   
 Groups support dynamic dropdown menus.   
 Dropdown name must be exposed and controllable from Unity.   
Must support: o Reassign tracks to groups o Create new dropdowns dynamically o Remove old dropdowns   
 If access is restricted: o Dropdown should gray out or disappear   
Each group has: o Independent color control

 Group list must be dynamic (not fixed size)

# Possible Keys

```json
{ "groups": [ { "groupId": "group_a", "groupId": "Group A", "groupId": "#ff6600", "visible": true, "enabled": true, "tracks": ["track_01", "track_02"] } ]   
} 
```

# // Comment out Per-User Availability

```json
{
    "availableGroups": ["group_a", "group_c"]
    "hiddenGroups": ["group_b"]
} 
```

# 1.4 Track Markers and Fill State

# Requirements

 Each track displays:

o A tempo-synced flashing marker   
o A fillable UI element (slider/progress style) – it fills within the time value provided   
o The flash and the fillable are in sync (when fillable reaches 1, then flash flashes).

 Fill value must be controllable (0–1)

# Possible Keys

```json
{
    "trackId": "track_01",
    "tempoFlashEnabled": true,
    "fillTime": 1 //in seconds
} 
```

# 1.5 Volume Control

# Requirements

```txt
- Volume UI can be:
    - shown/hidden
    - enabled/disabled
    - if(enableed){ if(userPressedPlay) Show();}
    - Could be a popup
    - If I press outside of the field of the volume, play stops and volume is not shown
    - Volume should be mapped logarithmically (DB SPL to 0-1 value) 
```

. If hidden:

```txt
o volume is controlled externally 
```

If visible:

```txt
o must support performative interaction (large UI) 
```

# Possible Keys

```json
{"volumeControlVisible":true, "volumeControlEnabled": true, "volumeValue":0.8} 
```

# 1.6 Optional Filter Control (SUPER OPTIONAL)

# Requirements

 Variable-state filter with 2D control pad

o $\mathrm{X}\rightarrow$ resonance (Q)

o $\mathbf{Y}\rightarrow$ frequency (logarithmic scale)

 Dropdown to select:

```txt
o low-pass 
```

```txt
o high-pass
```

```txt
band-pass 
```

 Can be activated/deactivated

 UI reorganizes when enabled

# Possible Keys

```json
{
    "filterVisible": true,
    "filterEnabled": true,
    "filterType": "lowpass",
    "filterPadX": 0.4,
    "filterPadY": 0.7
} 
```

# Possible Values

```json
{ "filterType": "lowpass" } { "filterType": "highpass" } { "filterType": "bandpass" } 
```

# 2. Spatial / Classroom Map

# 2.1 Classroom Map Display

# Requirements

 UI section shows classroom map   
 Supports 2D positioning   
 Position controlled via normalized values:

o x: 0–1

o y: 0–1

# Possible Keys

```json
{ "mapVisible": true, "playerPosX": 0.32, "playerPosY": 0.74 } 
```

# Alternative Structure

```json
{ "mapState": { "visible": true, "x": 0.32, "y": 0.74 } } 
```

# 3. Scoring

# 3.1 Per-Player Score

# Requirements

 Each player has a score

```txt
Score can be: activated deactivated reset directly set 
```

# Possible Keys

```json
{
    "scoreVisible": true,
    "scoreEnabled": true,
    "scoreValue": 12
} 
```

# Reset Command

```json
{"scoreReset":true} 
```

# 4. Voting System

# 4.1 Vote Window

# Requirements

 Vote window appears when triggered   
 Deactivate any other interaction until vote is finished   
Must support:

o custom vote text   
o dynamic number of options

 Layout:

o multiple-choice style   
o improved over Google Forms   
o Each vote option is a button, when selected, it returns the text or the button number

# Possible Keys

```json
{
    "voteVisible": true,
    "visibilityDuration": 15, //in seconds
    "voteQuestion": "Which rule should be active next?", "voteOptions": [
        "Fixed positions",
    ]
} 
```

```json
"Free blending", "Pulse only" ] } 
```

# 4.2 Vote Submission

# Requirements

 Every button press must: o call a function o post result to Unity o The results might be stored in one poll and then be all sent at once. I don’t need to know who chose what. But I need to know who didn’t vote.   
Alternative:

o manual download fallback

Must support:

o one vote per user   
o user can revise choice before submitting

# Payload

```jsonl
{ "UserID": "student_07", "voteId": "vote_003", "selectedOption": 1 } 
```

# 4.3 Vote Reset / Revision

# Requirements

 Ability to:

o reset all votes   
o allow vote revision

# Possible Keys

```json
{"voteAllowRevote":true, "voteResetAll":false } 
```

# Reset Command

```json
{"voteResetAll":true} 
```

# 5. Push-Only Timing Mode

# 5.1 Timing Challenge Mode

# Requirements

 Users must press at correct timing   
 UI includes:

o loading bar (red green red gradient)   
o center indicator bar

 Results must:

o be posted to Unity OR   
o be exportable as JSON

. Ideally:

o Unity receives notification in real time

# Possible Keys

```json
{
    "timingVisible": true,
    "timingEnabled": true,
    "timingValue": 0.52,
    "targetCenter": 0.5,
    "tosingTolerance": 0.08
} 
```

# User Event

```jsonl
{"UserID": "student_07", "timing": true, "timestamp": 1712345678} 
```

# 6. Recording (OPTIONAL)

# 6.1 Recording System

# Requirements

Optional feature   
Can record:

o interaction events   
o timing/button data   
o audio state changes

# Possible Keys

```javascript
{ "recordEnabled": false, "recordState": "idle" } 
```

# Commands

```json
{ "recordCommand": "start" } { "recordCommand": "stop" } 
```

# 7. Global Reset

# 7.1 Reset All State

# Requirements

Must reset:

playback state   
 loop state   
pulse state   
active groups   
 track fill values   
scores   
voting state   
map position   
 volume control   
timing mode   
optional filter state

# Commands

```txt
{"resetAll":true} or 
```

```txt
{ "command": "reset_all_state" } 
```

# 8. Unified Command Structure

# Base Format

```json
{
    "command": "update_track",
    "payload": {
        "trackId": "track_01",
        "loopEnabled": false,
        "worthValue": 0.4
    }
} 
```

# Examples

# Show Vote

```txt
{ "command": "show Vote", "payload": { "voteId": "vote_003", "voteQuestion": "Which rule should be active next?", "voteOptions": ["Rule A", "Rule B", "Rule C"], "VoteAllowRevote": true }   
} 
```

# Update Map Position

```jsonl
{"command": "update_map_position", "payload": { "UserID": "student_07", "x": 0.25, "y": 0.82 }   
} 
```

# Reset Everything

```txt
{ "command": "reset_all_state" } 
```

# 9. General Architecture Requirement

 UI must be state-driven   
 All modules must support:

o show / hide   
o enable / disable   
o dynamic creation / removal   
o reset

 Dynamic UI generation is critical for:

o sample groups   
o voting options   
o optional modules (filters)