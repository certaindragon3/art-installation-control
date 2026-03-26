import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  Monitor,
  Radio,
  ArrowRight,
  Hexagon,
  Music,
  Palette,
  MessageSquare,
} from "lucide-react";

export default function Home() {
  const [receiverId, setReceiverId] = useState("");
  const [, setLocation] = useLocation();

  const handleJoinAsReceiver = () => {
    const id = receiverId.trim() || `r${Date.now().toString(36)}`;
    setLocation(`/receiver/${id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />
        <div className="container relative py-20 lg:py-28">
          <div className="max-w-3xl mx-auto text-center">
            <Badge variant="secondary" className="mb-6">
              <Hexagon className="w-3 h-3 mr-1" />
              Interactive Art Installation
            </Badge>
            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight mb-4">
              Multi-Receiver
              <br />
              <span className="text-primary">Control System</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              A real-time WebSocket-based control system for interactive art
              installations. One controller, multiple receivers, independent
              control per device.
            </p>
          </div>
        </div>
      </div>

      {/* Role Selection */}
      <div className="container pb-20">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            {/* Controller Card */}
            <Card className="group hover:border-primary/30 transition-all hover:shadow-lg">
              <CardHeader>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/15 transition-colors">
                  <Zap className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-xl">Controller</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  The central control panel. Manage all connected receivers,
                  send audio commands, change colors, and broadcast messages.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs">
                    <Music className="w-3 h-3 mr-1" />
                    Audio
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    <Palette className="w-3 h-3 mr-1" />
                    Color
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    <MessageSquare className="w-3 h-3 mr-1" />
                    Text
                  </Badge>
                </div>
                <Link href="/controller">
                  <Button className="w-full mt-2 group-hover:bg-primary/90">
                    Open Controller
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Receiver Card */}
            <Card className="group hover:border-primary/30 transition-all hover:shadow-lg">
              <CardHeader>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/15 transition-colors">
                  <Monitor className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-xl">Receiver</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  A terminal endpoint that receives and displays commands. Each
                  receiver has a unique ID for independent control.
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={receiverId}
                    onChange={(e) => setReceiverId(e.target.value)}
                    placeholder="Enter Receiver ID (or leave blank for auto)"
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button
                    className="w-full group-hover:bg-primary/90"
                    onClick={handleJoinAsReceiver}
                  >
                    Join as Receiver
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Link href="/receiver/A">
                    <Button variant="outline" size="sm">
                      <Radio className="w-3 h-3 mr-1" />
                      Receiver A
                    </Button>
                  </Link>
                  <Link href="/receiver/B">
                    <Button variant="outline" size="sm">
                      <Radio className="w-3 h-3 mr-1" />
                      Receiver B
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Architecture Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">System Architecture</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <div className="p-4 rounded-lg bg-muted/50">
                  <Zap className="w-8 h-8 mx-auto mb-2 text-primary" />
                  <p className="font-medium text-sm">Controller</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    /controller
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Sends targeted commands
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50 flex flex-col items-center justify-center">
                  <div className="text-xs text-muted-foreground mb-1">
                    WebSocket (Socket.IO)
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-8 h-px bg-primary" />
                    <ArrowRight className="w-3 h-3 text-primary" />
                  </div>
                  <p className="font-medium text-sm mt-1">Server</p>
                  <p className="text-xs text-muted-foreground">
                    Routes messages by targetId
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <Monitor className="w-8 h-8 mx-auto mb-2 text-primary" />
                  <p className="font-medium text-sm">Receivers</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    /receiver/:id
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Execute commands independently
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
