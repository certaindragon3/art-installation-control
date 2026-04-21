List of final fixes:

Change the filling "slider" to a moving bar (disjointed from the time duration of the challenge and moving faster left->right->left).
The spawn position of the moving bar at each new challenge is random.
BIgger color icon for the challenge
Add a way to download the score from both Economy (remaining seconds) and Score system.
Color challenge, either of the two buttons needs to be linked to a sound file. The "right choice" is taken from the pool of available tracks , while the "wrong choice" is one among any other track. I would prefer to choose the track in advance and show the name in the color block. It is also acceptable to trigger the selection randomly after color choice.
Meet on Friday 4 PM
I will send you ~40 more samples to upload by Friday
I will send you .jpg of the class map
Double check the map coordinates re-mapper. The  problem seems to be that the received parameters are acrually not passed to the controller. The icon does not move, so it is unlikely it is a mapping issue. It is probably a communication issue.

economy关闭的时候最上方不要显示disabled控件，最好那个卡片不要显示

economy跟是否能放track要解耦

Disentangle economy logic from tracks playability (the state is determined by accumulated seconds only when economy is active).
Remove the "Disabled" post when time challenge or economy are not used.
Remove "ColorChallenge" explanation from the interface, so the options are visible right away.

Assigned tracks should be always shown in scrambled order, for now they are shown always in the same order (e.g., all city first, all nature second, and within those sets they always have predetermined order). Just shuffle their order before showing


