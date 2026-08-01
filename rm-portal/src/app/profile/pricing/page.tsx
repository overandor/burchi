"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { DollarSign, TrendingUp, Calendar, Lightbulb, Info } from "lucide-react"
import { useApi, api, type KpiSnapshot } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"
import { useState } from "react"

const PRICING_TIERS = [
  { duration: "60 min", price: 120, sessions: 0, popular: false },
  { duration: "90 min", price: 170, sessions: 0, popular: true },
  { duration: "120 min", price: 220, sessions: 0, popular: false },
]

export default function PricingManagerPage() {
  const { data: kpi, loading } = useApi<KpiSnapshot>(() => api.getLatestKpi(), [], 15000)
  const { data: controlState, refetch } = useApi<Record<string, string>>(() => api.getControlState(), [])
  const [priceChangeEnabled, setPriceChangeEnabled] = useState(false)
  const [toggling, setToggling] = useState(false)

  const capPriceChanges = controlState?.cap_price_changes === "true" || priceChangeEnabled

  const handleTogglePriceChange = async (checked: boolean) => {
    setPriceChangeEnabled(checked)
    setToggling(true)
    await api.setControlState("cap_price_changes", checked ? "true" : "false")
    await refetch()
    setToggling(false)
  }

  if (loading && !kpi) return <LoadingState label="Loading pricing data..." />

  const totalRevenue = kpi?.revenue ?? 0
  const bookings = kpi?.bookings ?? 0
  const avgRevenuePerBooking = bookings > 0 ? totalRevenue / bookings : 0

  return (
    <div className="space-y-6">
      <PageHeader title="Pricing Manager" subtitle="Manage pricing tiers and revenue optimization" />

      {/* Revenue Metrics */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          icon={DollarSign}
          value={`$${totalRevenue.toLocaleString()}`}
          label="Total Revenue"
          color="text-emerald-400"
        />
        <StatCard icon={Calendar} value={bookings.toLocaleString()} label="Bookings" color="text-blue-400" />
        <StatCard
          icon={TrendingUp}
          value={avgRevenuePerBooking > 0 ? `$${avgRevenuePerBooking.toFixed(0)}` : "—"}
          label="Avg Revenue / Booking"
          color="text-orange-400"
        />
      </div>

      {/* Pricing Tiers */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <DollarSign className="h-5 w-5 text-emerald-400" />
          <CardTitle className="text-base text-foreground">Pricing Tiers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PRICING_TIERS.map((tier) => (
              <div
                key={tier.duration}
                className={`relative rounded-lg border p-4 ${
                  tier.popular
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-border bg-card/30"
                }`}
              >
                {tier.popular && (
                  <Badge
                    variant="outline"
                    className="absolute -top-2 left-4 border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px]"
                  >
                    MOST POPULAR
                  </Badge>
                )}
                <div className="text-center">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{tier.duration}</span>
                  <p className="mt-1 text-3xl font-bold text-foreground">
                    ${tier.price}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">per session</p>
                </div>
                <Separator className="my-3 bg-accent" />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Sessions</span>
                  <span className="font-bold text-foreground tabular-nums">{tier.sessions}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Price Change Capability */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <TrendingUp className="h-5 w-5 text-purple-400" />
          <CardTitle className="text-base text-foreground">Price Change Capability</CardTitle>
          <Badge
            variant="outline"
            className={`ml-auto text-[9px] ${
              capPriceChanges
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-border/80 bg-accent/30 text-muted-foreground"
            }`}
          >
            {capPriceChanges ? "ENABLED" : "DISABLED"}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card/30 px-4 py-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                  capPriceChanges ? "bg-emerald-500/10" : "bg-accent/30"
                }`}
              >
                <DollarSign className={`h-4 w-4 ${capPriceChanges ? "text-emerald-400" : "text-muted-foreground/60"}`} />
              </div>
              <div>
                <span className="text-sm text-foreground">Allow Price Changes</span>
                <p className="text-[10px] text-muted-foreground">
                  Enable the AI to adjust pricing tiers based on demand and conversion data
                </p>
              </div>
            </div>
            <Switch checked={capPriceChanges} onCheckedChange={handleTogglePriceChange} disabled={toggling} />
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            Control key: <code className="text-muted-foreground">cap_price_changes</code> — currently{" "}
            <span className="text-muted-foreground">{controlState?.cap_price_changes || "false"}</span>
          </div>
        </CardContent>
      </Card>

      {/* Pricing Optimization Suggestion */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Lightbulb className="h-5 w-5 text-amber-400" />
          <CardTitle className="text-base text-foreground">Pricing Optimization Suggestion</CardTitle>
          <Badge variant="outline" className="ml-auto border-amber-500/30 bg-amber-500/10 text-amber-400 text-[9px]">
            AI RECOMMENDATION
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-sm text-foreground/80 leading-relaxed">
              Based on current conversion rates and visitor engagement patterns, the 90-minute session shows the
              highest demand at <span className="font-bold text-amber-400">$170</span>. Consider testing a{" "}
              <span className="font-bold text-emerald-400">+10% price increase</span> on the 120-minute tier to
              capture additional margin, as it currently has the lowest booking volume.
            </p>
          </div>
          <Separator className="bg-accent" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Suggested 60min</span>
              <p className="text-sm font-bold text-foreground">$120</p>
              <span className="text-[9px] text-muted-foreground">No change</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Suggested 90min</span>
              <p className="text-sm font-bold text-foreground">$170</p>
              <span className="text-[9px] text-muted-foreground">No change</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Suggested 120min</span>
              <p className="text-sm font-bold text-emerald-400">$242</p>
              <span className="text-[9px] text-emerald-400">+10% (test)</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
