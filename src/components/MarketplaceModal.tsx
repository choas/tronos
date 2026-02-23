import { createSignal, createEffect, createMemo, Show, For } from "solid-js";
import {
  MARKETPLACE_PACKAGES,
  COLLECTIONS,
  isTierAuthorized,
  type CollectionId,
  type MarketplacePackage,
} from "../marketplace/registry";

interface MarketplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  getInstalledPackages: () => Set<string>;
  onInstall: (packageName: string) => Promise<boolean>;
  onUninstall: (packageName: string) => Promise<boolean>;
  getAuthStatus: () => { loggedIn: boolean; tier: string | null } | null;
  onAuthLogin: () => void;
}

type ActiveTab = "all" | CollectionId;

const COLLECTION_COUNTS = new Map<string, number>();
for (const pkg of MARKETPLACE_PACKAGES) {
  COLLECTION_COUNTS.set(pkg.collection, (COLLECTION_COUNTS.get(pkg.collection) || 0) + 1);
}

export function MarketplaceModal(props: MarketplaceModalProps) {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [activeCollection, setActiveCollection] = createSignal<ActiveTab>("all");
  const [installedSet, setInstalledSet] = createSignal<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = createSignal<string | null>(null);

  // Refresh installed set when modal opens
  createEffect(() => {
    if (props.isOpen) {
      setInstalledSet(props.getInstalledPackages());
      setSearchQuery("");
      setActiveCollection("all");
    }
  });

  const filteredPackages = createMemo(() => {
    const query = searchQuery().toLowerCase();
    const tab = activeCollection();

    return MARKETPLACE_PACKAGES.filter((pkg) => {
      if (tab !== "all" && pkg.collection !== tab) return false;
      if (query && !pkg.name.toLowerCase().includes(query) && !pkg.description.toLowerCase().includes(query)) return false;
      return true;
    });
  });

  const handleInstall = async (name: string) => {
    setPendingAction(name);
    try {
      await props.onInstall(name);
      // Refresh installed set
      setInstalledSet(props.getInstalledPackages());
    } finally {
      setPendingAction(null);
    }
  };

  const handleUninstall = async (name: string) => {
    setPendingAction(name);
    try {
      await props.onUninstall(name);
      setInstalledSet(props.getInstalledPackages());
    } finally {
      setPendingAction(null);
    }
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
  };

  const tierLabel = (pkg: MarketplacePackage) => {
    if (pkg.tier === "pro") return "PRO";
    if (pkg.tier === "enterprise") return "ENT";
    return null;
  };

  return (
    <Show when={props.isOpen}>
      <div class="marketplace-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown} tabIndex={-1} ref={(el) => el.focus()}>
        <div class="marketplace-modal">
          {/* Header */}
          <div class="marketplace-header">
            <h2>TronOS Marketplace</h2>
            <button class="marketplace-close" onClick={props.onClose}>&times;</button>
          </div>

          {/* Search */}
          <div class="marketplace-search">
            <input
              type="text"
              placeholder="Search packages..."
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
          </div>

          {/* Collection tabs */}
          <div class="marketplace-tabs">
            <button
              class={`marketplace-tab${activeCollection() === "all" ? " active" : ""}`}
              onClick={() => setActiveCollection("all")}
            >
              All ({MARKETPLACE_PACKAGES.length})
            </button>
            <For each={COLLECTIONS}>
              {(col) => (
                <button
                  class={`marketplace-tab${activeCollection() === col.id ? " active" : ""}`}
                  onClick={() => setActiveCollection(col.id)}
                >
                  {col.label} ({COLLECTION_COUNTS.get(col.id) || 0})
                </button>
              )}
            </For>
          </div>

          {/* Package grid */}
          <div class="marketplace-body">
            <Show when={filteredPackages().length === 0}>
              <div class="marketplace-empty">No packages match your search.</div>
            </Show>
            <For each={filteredPackages()}>
              {(pkg) => {
                const isInstalled = () => installedSet().has(pkg.name);
                const isPending = () => pendingAction() === pkg.name;
                const isEnterprise = pkg.source === "enterprise";
                const tier = tierLabel(pkg);

                // Auth-aware state for enterprise packages
                const authStatus = () => isEnterprise ? props.getAuthStatus() : null;
                const isAuthorized = () => {
                  if (!isEnterprise) return true;
                  const status = authStatus();
                  if (!status?.loggedIn || !status.tier) return false;
                  return isTierAuthorized(status.tier, pkg.tier || "free");
                };
                const isLoggedIn = () => authStatus()?.loggedIn ?? false;

                return (
                  <div class={`marketplace-card${isEnterprise && !isAuthorized() ? " enterprise" : ""}`}>
                    <div class="marketplace-card-header">
                      <span class="marketplace-card-name">{pkg.name}</span>
                      <span class={`marketplace-badge marketplace-badge-${pkg.collection}`}>{pkg.collection}</span>
                      <Show when={tier}>
                        <span class={`marketplace-badge marketplace-badge-${tier === "PRO" ? "pro" : "ent"}`}>{tier}</span>
                      </Show>
                      <Show when={isInstalled()}>
                        <span class="marketplace-badge marketplace-badge-installed">installed</span>
                      </Show>
                    </div>
                    <div class="marketplace-card-desc">{pkg.description}</div>
                    <div class="marketplace-card-footer">
                      <span class="marketplace-card-version">v{pkg.version}</span>
                      {/* Enterprise: not logged in → Login button */}
                      <Show when={isEnterprise && !isLoggedIn()}>
                        <button
                          class="marketplace-btn-login"
                          onClick={() => props.onAuthLogin()}
                        >
                          &#x1f512; Login
                        </button>
                      </Show>
                      {/* Enterprise: logged in but insufficient tier */}
                      <Show when={isEnterprise && isLoggedIn() && !isAuthorized()}>
                        <button class="marketplace-btn-upgrade" disabled>
                          &#x1f512; Requires {tier}
                        </button>
                      </Show>
                      {/* Enterprise: authorized and installed */}
                      <Show when={isEnterprise && isAuthorized() && isInstalled()}>
                        <button
                          class="marketplace-btn-uninstall"
                          disabled={isPending()}
                          onClick={() => handleUninstall(pkg.name)}
                        >
                          {isPending() ? "..." : "Uninstall"}
                        </button>
                      </Show>
                      {/* Enterprise: authorized and not installed */}
                      <Show when={isEnterprise && isAuthorized() && !isInstalled()}>
                        <button
                          class="marketplace-btn-install"
                          disabled={isPending()}
                          onClick={() => handleInstall(pkg.name)}
                        >
                          {isPending() ? "..." : "Install"}
                        </button>
                      </Show>
                      {/* Non-enterprise: installed */}
                      <Show when={!isEnterprise && isInstalled()}>
                        <button
                          class="marketplace-btn-uninstall"
                          disabled={isPending()}
                          onClick={() => handleUninstall(pkg.name)}
                        >
                          {isPending() ? "..." : "Uninstall"}
                        </button>
                      </Show>
                      {/* Non-enterprise: not installed */}
                      <Show when={!isEnterprise && !isInstalled()}>
                        <button
                          class="marketplace-btn-install"
                          disabled={isPending()}
                          onClick={() => handleInstall(pkg.name)}
                        >
                          {isPending() ? "..." : "Install"}
                        </button>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}
