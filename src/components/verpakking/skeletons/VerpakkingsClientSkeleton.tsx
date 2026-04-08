/**
 * Full-page skeleton for VerpakkingsClient.
 * Dimensions match the actual layout exactly to prevent layout shifts (CLS = 0).
 */
export function VerpakkingsClientSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Header skeleton */}
      <div className="bg-card border-b border-border px-3 py-2 lg:px-4 lg:py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-muted rounded-lg animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-5 w-32 bg-muted rounded animate-pulse" />
              <div className="h-3 w-48 bg-muted rounded animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-28 bg-muted rounded-lg animate-pulse" />
            <div className="h-9 w-28 bg-muted rounded-lg animate-pulse" />
          </div>
        </div>
      </div>

      {/* Main content area — matches actual flex layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Center area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 flex overflow-hidden">
            {/* Products column */}
            <div className="flex flex-col flex-1 lg:flex-none lg:w-1/2 lg:border-r border-border">
              {/* Column header - desktop */}
              <div className="hidden lg:block px-4 py-3 border-b border-border bg-muted/30">
                <div className="h-5 w-32 bg-muted rounded animate-pulse" />
              </div>
              {/* Product cards */}
              <div className="flex-1 overflow-hidden p-3 lg:p-4 space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                    <div className="w-[64px] h-[64px] lg:w-[104px] lg:h-[104px] bg-muted rounded-lg flex-shrink-0 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-1/3 bg-muted rounded animate-pulse" />
                    </div>
                    <div className="h-8 w-12 bg-muted rounded animate-pulse" />
                  </div>
                ))}
              </div>
            </div>

            {/* Boxes column */}
            <div className="hidden lg:flex flex-col lg:w-1/2">
              {/* Column header */}
              <div className="px-4 py-3 border-b border-border bg-muted/30">
                <div className="h-5 w-24 bg-muted rounded animate-pulse" />
              </div>
              {/* Box cards */}
              <div className="flex-1 overflow-hidden p-3 lg:p-4 space-y-3">
                <div className="border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="h-5 w-40 bg-muted rounded animate-pulse" />
                    <div className="h-8 w-24 bg-muted rounded-lg animate-pulse" />
                  </div>
                  <div className="h-20 bg-muted/30 rounded-lg animate-pulse" />
                </div>
                {/* Dashed add-box placeholder */}
                <div className="h-12 border-2 border-dashed border-border rounded-lg animate-pulse" />
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar - desktop only */}
        <div className="w-64 xl:w-72 border-l border-border flex-shrink-0 bg-muted/20 hidden lg:block p-4 space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-20 bg-muted rounded animate-pulse" />
              <div className="h-3 w-full bg-muted rounded animate-pulse" />
              <div className="h-3 w-2/3 bg-muted rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
