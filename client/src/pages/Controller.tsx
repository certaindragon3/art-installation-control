import { useState, useCallback } from "react";
import { useSocket } from "@/hooks/useSocket";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Play,
  Pause,
  Music,
  Palette,
  MessageSquare,
  Radio,
  Wifi,
  WifiOff,
  Send,
  Volume2,
  VolumeX,
  Monitor,
  Zap,
} from "lucide-react";
import type { ControlMessage, ReceiverState } from "@shared/wsTypes";

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#6366f1", "#a855f7",
  "#ec4899", "#f43f5e", "#ffffff", "#000000",
];

export default function Controller() {
  const { connected, receivers, sendCommand } = useSocket({
    role: "controller",
  });
  const [selectedReceiver, setSelectedReceiver] = useState<string>("");
  const [textInput, setTextInput] = useState("");
  const [customColor, setCustomColor] = useState("#6366f1");

  const selectedState = receivers.find(
    (r) => r.receiverId === selectedReceiver
  );

  const send = useCallback(
    (msg: Omit<ControlMessage, "timestamp">) => {
      sendCommand({
        ...msg,
        timestamp: new Date().toISOString(),
      } as ControlMessage);
    },
    [sendCommand]
  );

  const handleAudioControl = (trackId: 1 | 2, action: "play" | "pause") => {
    if (!selectedReceiver) return;
    send({
      type: "audio_control",
      targetId: selectedReceiver,
      payload: { trackId, action },
    });
  };

  const handleAudioPlayable = (trackId: 1 | 2, playable: boolean) => {
    if (!selectedReceiver) return;
    send({
      type: "audio_playable",
      targetId: selectedReceiver,
      payload: { trackId, playable },
    });
  };

  const handleColorChange = (color: string) => {
    if (!selectedReceiver) return;
    setCustomColor(color);
    send({
      type: "color_change",
      targetId: selectedReceiver,
      payload: { color },
    });
  };

  const handleTextMessage = () => {
    if (!selectedReceiver || !textInput.trim()) return;
    send({
      type: "text_message",
      targetId: selectedReceiver,
      payload: { text: textInput.trim() },
    });
    setTextInput("");
  };

  const handleBroadcastText = () => {
    if (!textInput.trim()) return;
    send({
      type: "text_message",
      targetId: "*",
      payload: { text: textInput.trim() },
    });
    setTextInput("");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Art Installation Controller
              </h1>
              <p className="text-xs text-muted-foreground">
                Real-time multi-receiver control panel
              </p>
            </div>
          </div>
          <Badge
            variant={connected ? "default" : "destructive"}
            className="gap-1.5"
          >
            {connected ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            {connected ? "Connected" : "Disconnected"}
          </Badge>
        </div>
      </header>

      <div className="container py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Receiver List */}
          <div className="lg:col-span-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Monitor className="w-4 h-4" />
                  Connected Receivers
                  <Badge variant="secondary" className="ml-auto">
                    {receivers.filter((r) => r.connected).length}/
                    {receivers.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {receivers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Radio className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No receivers connected yet</p>
                    <p className="text-xs mt-1">
                      Open /receiver/:id in another tab
                    </p>
                  </div>
                ) : (
                  receivers.map((r) => (
                    <ReceiverCard
                      key={r.receiverId}
                      receiver={r}
                      selected={selectedReceiver === r.receiverId}
                      onClick={() => setSelectedReceiver(r.receiverId)}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: Control Panel */}
          <div className="lg:col-span-8 space-y-6">
            {/* Target Selector */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <Label className="text-sm font-medium whitespace-nowrap">
                    Target Receiver
                  </Label>
                  <Select
                    value={selectedReceiver}
                    onValueChange={setSelectedReceiver}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a receiver to control" />
                    </SelectTrigger>
                    <SelectContent>
                      {receivers.map((r) => (
                        <SelectItem key={r.receiverId} value={r.receiverId}>
                          <span className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                r.connected ? "bg-green-500" : "bg-red-500"
                              }`}
                            />
                            {r.label} ({r.receiverId})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {selectedReceiver && selectedState ? (
              <>
                {/* Audio Control */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Music className="w-4 h-4" />
                      Audio Control
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {([1, 2] as const).map((trackId) => {
                      const track =
                        trackId === 1
                          ? selectedState.audio.track1
                          : selectedState.audio.track2;
                      return (
                        <div
                          key={trackId}
                          className="flex items-center gap-4 p-3 rounded-lg bg-muted/50"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm font-medium">
                                Track {trackId}
                              </span>
                              <Badge
                                variant={track.playing ? "default" : "secondary"}
                                className="text-xs"
                              >
                                {track.playing ? "Playing" : "Paused"}
                              </Badge>
                              {!track.playable && (
                                <Badge variant="destructive" className="text-xs">
                                  Disabled
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant={track.playing ? "secondary" : "default"}
                                onClick={() =>
                                  handleAudioControl(
                                    trackId,
                                    track.playing ? "pause" : "play"
                                  )
                                }
                                disabled={!track.playable}
                              >
                                {track.playing ? (
                                  <Pause className="w-3.5 h-3.5 mr-1" />
                                ) : (
                                  <Play className="w-3.5 h-3.5 mr-1" />
                                )}
                                {track.playing ? "Pause" : "Play"}
                              </Button>
                              <Separator
                                orientation="vertical"
                                className="h-6"
                              />
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={track.playable}
                                  onCheckedChange={(checked) =>
                                    handleAudioPlayable(trackId, checked)
                                  }
                                />
                                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                                  {track.playable ? (
                                    <Volume2 className="w-3 h-3" />
                                  ) : (
                                    <VolumeX className="w-3 h-3" />
                                  )}
                                  {track.playable ? "Playable" : "Disabled"}
                                </Label>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {/* Color Control */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Palette className="w-4 h-4" />
                      Icon Color
                      <div
                        className="w-5 h-5 rounded-full border border-border ml-auto"
                        style={{ backgroundColor: selectedState.iconColor }}
                      />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {PRESET_COLORS.map((color) => (
                        <button
                          key={color}
                          className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${
                            customColor === color
                              ? "border-primary ring-2 ring-primary/30"
                              : "border-border"
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() => handleColorChange(color)}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={customColor}
                        onChange={(e) => handleColorChange(e.target.value)}
                        className="w-10 h-10 rounded cursor-pointer border border-border"
                      />
                      <span className="text-sm text-muted-foreground font-mono">
                        {customColor}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Text Message */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Text Message
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedState.lastMessage && (
                      <div className="mb-3 p-2 rounded bg-muted/50 text-sm text-muted-foreground">
                        Last sent: "{selectedState.lastMessage}"
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && handleTextMessage()
                        }
                        placeholder="Type a message to send..."
                        className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <Button onClick={handleTextMessage} disabled={!textInput.trim()}>
                        <Send className="w-4 h-4 mr-1" />
                        Send
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleBroadcastText}
                        disabled={!textInput.trim()}
                      >
                        <Radio className="w-4 h-4 mr-1" />
                        Broadcast
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="py-16 text-center text-muted-foreground">
                  <Radio className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-medium">No Receiver Selected</p>
                  <p className="text-sm mt-1">
                    {receivers.length === 0
                      ? "Waiting for receivers to connect..."
                      : "Select a receiver from the list to begin controlling"}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReceiverCard({
  receiver,
  selected,
  onClick,
}: {
  receiver: ReceiverState;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border hover:border-primary/30 hover:bg-muted/50"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">{receiver.label}</span>
        <span
          className={`w-2 h-2 rounded-full ${
            receiver.connected ? "bg-green-500" : "bg-red-500"
          }`}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        ID: {receiver.receiverId}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <div
          className="w-3 h-3 rounded-full border border-border"
          style={{ backgroundColor: receiver.iconColor }}
        />
        <span className="text-xs text-muted-foreground">
          T1:{" "}
          {receiver.audio.track1.playing
            ? "Playing"
            : receiver.audio.track1.playable
            ? "Ready"
            : "Off"}
          {" | "}
          T2:{" "}
          {receiver.audio.track2.playing
            ? "Playing"
            : receiver.audio.track2.playable
            ? "Ready"
            : "Off"}
        </span>
      </div>
    </button>
  );
}
