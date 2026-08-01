"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Image as ImageIcon, RefreshCw, MoveUp, MoveDown, Info } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader } from "@/components/ui-helpers"
import { useState } from "react"

const PHOTO_SLOTS = [
  { position: 1, label: "Primary", status: "active" },
  { position: 2, label: "Secondary", status: "active" },
  { position: 3, label: "Tertiary", status: "active" },
  { position: 4, label: "Gallery 4", status: "placeholder" },
  { position: 5, label: "Gallery 5", status: "placeholder" },
  { position: 6, label: "Gallery 6", status: "placeholder" },
]

export default function PhotoManagerPage() {
  const { data: controlState, loading, refetch } = useApi<Record<string, string>>(
    () => api.getControlState(),
    [],
    15000,
  )
  const [rotationEnabled, setRotationEnabled] = useState(false)
  const [toggling, setToggling] = useState(false)

  // Sync local state when control state loads
  const capPhotoRotation = controlState?.cap_photo_rotation === "true" || rotationEnabled

  const handleToggleRotation = async (checked: boolean) => {
    setRotationEnabled(checked)
    setToggling(true)
    await api.setControlState("cap_photo_rotation", checked ? "true" : "false")
    await refetch()
    setToggling(false)
  }

  if (loading && !controlState) return <LoadingState label="Loading photo manager..." />

  return (
    <div className="space-y-6">
      <PageHeader title="Photo Manager" subtitle="Manage profile photos, ordering, and rotation" />

      {/* Photo Rotation Capability */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <RefreshCw className="h-5 w-5 text-purple-400" />
          <CardTitle className="text-base text-foreground">Photo Rotation</CardTitle>
          <Badge
            variant="outline"
            className={`ml-auto text-[9px] ${
              capPhotoRotation
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-border/80 bg-accent/30 text-muted-foreground"
            }`}
          >
            {capPhotoRotation ? "ENABLED" : "DISABLED"}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card/30 px-4 py-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                  capPhotoRotation ? "bg-emerald-500/10" : "bg-accent/30"
                }`}
              >
                <RefreshCw className={`h-4 w-4 ${capPhotoRotation ? "text-emerald-400" : "text-muted-foreground/60"}`} />
              </div>
              <div>
                <span className="text-sm text-foreground">Auto Photo Rotation</span>
                <p className="text-[10px] text-muted-foreground">
                  Allow the system to automatically rotate and reorder profile photos
                </p>
              </div>
            </div>
            <Switch checked={capPhotoRotation} onCheckedChange={handleToggleRotation} disabled={toggling} />
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            Control key: <code className="text-muted-foreground">cap_photo_rotation</code> — currently{" "}
            <span className="text-muted-foreground">{controlState?.cap_photo_rotation || "false"}</span>
          </div>
        </CardContent>
      </Card>

      {/* Photo Grid */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <ImageIcon className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-base text-foreground">Photo Gallery</CardTitle>
          <span className="ml-auto text-[10px] text-muted-foreground">{PHOTO_SLOTS.length} slots</span>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {PHOTO_SLOTS.map((slot) => (
              <div
                key={slot.position}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-card/30"
              >
                {/* Placeholder */}
                <div className="flex h-full w-full flex-col items-center justify-center gap-2">
                  <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
                  <span className="text-[10px] text-muted-foreground/60">Photo {slot.position}</span>
                </div>

                {/* Position badge */}
                <div className="absolute left-2 top-2">
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${
                      slot.status === "active"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-border/80 bg-accent/30 text-muted-foreground"
                    }`}
                  >
                    #{slot.position} {slot.label}
                  </Badge>
                </div>

                {/* Order controls */}
                <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded border border-border/80 bg-card/80 text-muted-foreground hover:text-foreground"
                    disabled={slot.position === 1}
                  >
                    <MoveUp className="h-3 w-3" />
                  </button>
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded border border-border/80 bg-card/80 text-muted-foreground hover:text-foreground"
                    disabled={slot.position === PHOTO_SLOTS.length}
                  >
                    <MoveDown className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Photo Ordering State */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <MoveUp className="h-5 w-5 text-amber-400" />
          <CardTitle className="text-base text-foreground">Photo Ordering State</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {PHOTO_SLOTS.map((slot, i) => (
              <div key={slot.position}>
                <div className="flex items-center justify-between rounded-lg border border-border/50 bg-card/30 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-accent text-[10px] font-bold text-muted-foreground">
                      {slot.position}
                    </span>
                    <span className="text-sm text-foreground">{slot.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${
                        slot.status === "active"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border-border/80 bg-accent/30 text-muted-foreground"
                      }`}
                    >
                      {slot.status === "active" ? "FILLED" : "EMPTY"}
                    </Badge>
                  </div>
                </div>
                {i < PHOTO_SLOTS.length - 1 && <Separator className="my-1 bg-accent/30" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
