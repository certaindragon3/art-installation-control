import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Monitor, Radio, ArrowRight, Hexagon } from "lucide-react";

const RECEIVER_ID_STORAGE_KEY = "art-installation:last-receiver-id";

export default function Home() {
  const [receiverId, setReceiverId] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(RECEIVER_ID_STORAGE_KEY) || "";
  });
  const [, setLocation] = useLocation();
  const trimmedReceiverId = receiverId.trim();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (trimmedReceiverId) {
      window.localStorage.setItem(RECEIVER_ID_STORAGE_KEY, trimmedReceiverId);
      return;
    }

    window.localStorage.removeItem(RECEIVER_ID_STORAGE_KEY);
  }, [trimmedReceiverId]);

  const handleJoinAsReceiver = () => {
    if (!trimmedReceiverId) return;
    setLocation(`/receiver/${trimmedReceiverId}`);
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
              Enter your assigned screen name to join the shared sound space.
            </p>
          </div>
        </div>
      </div>

      {/* Role Selection */}
      <div className="container pb-20">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12 grid grid-cols-1 gap-6">
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
                  Each screen keeps its own color, position, seconds, and sound
                  choices.
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={receiverId}
                    onChange={e => setReceiverId(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleJoinAsReceiver()}
                    placeholder="Enter Receiver ID"
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button
                    className="w-full group-hover:bg-primary/90"
                    onClick={handleJoinAsReceiver}
                    disabled={!trimmedReceiverId}
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">How To Join</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 text-center md:grid-cols-2">
                <div className="p-4 rounded-lg bg-muted/50">
                  <Monitor className="w-8 h-8 mx-auto mb-2 text-primary" />
                  <p className="font-medium text-sm">Use Your Screen Name</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Example: A, B, entrance, window
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <Hexagon className="w-8 h-8 mx-auto mb-2 text-primary" />
                  <p className="font-medium text-sm">Stay On This Page</p>
                  <p className="text-xs text-muted-foreground">
                    The installation updates your screen automatically.
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
