# Defender for Cloud — Security Coverage Workbook

An Azure Monitor Workbook that answers **"How well is the cloud estate protected?"** in a single view. It uses Azure Resource Graph to surface Defender for Cloud data across all your subscriptions without requiring a Log Analytics workspace.

Current workbook version: **v1.1** (2026-05-07)

---

## What's in the workbook

| Tab | What it shows |
|---|---|
| **Executive Summary** | KPI tiles: average Secure Score, total subscriptions, subs with no Defender plan, subs with full coverage. Includes a drill-down table of subscriptions with zero Defender plans and a Top 10 recommendations grid filtered by severity (High/Medium). |
| **Secure Score per Subscription** | Sortable grid and bar chart of Secure Score %, healthy/unhealthy controls, and max points per subscription. |
| **Protection Gaps** | Resources (VMs, storage accounts, containers, etc.) split into Protected vs Unprotected, with a coverage % heatmap, a per-subscription drill-down of unprotected resources, and a **Stopped** column showing deallocated (powered-off) VMs. **DCSPM/CSPM and Resource Manager are shown as subscription counts** (total subscriptions vs protected/unprotected subscriptions). Includes detailed list of unprotected server resources. |
| **Plan Status per Subscription** | Matrix of all 14 Defender plans (CSPM, Servers, Containers, App Services, Storage, SQL, Cosmos DB, Key Vault, Resource Manager, APIs, AI, DNS) with On/Off/On(subPlan) icons per subscription. |
| **Extensions & Features** | Per-plan extension tables showing which optional capabilities are enabled: CSPM (7 extensions), Servers (6), Containers (5), Storage (2), AI (3). |
| **Regulatory Compliance** | Compliance status by standard and subscription, compliance percentage chart, and governance gap view for subscriptions with no Standard Defender plans. |

---

## Prerequisites

- **Azure subscription(s)** with Defender for Cloud enabled on at least one plan
- **Azure Monitor Workbooks** access (built into the Azure portal — no additional cost)
- **Reader** role (or higher) on the subscriptions you want to query
- No Log Analytics workspace required — all queries use Azure Resource Graph

---

## Installation

### Option 1 — Import via the Azure Portal (recommended)

1. Open the [Azure portal](https://portal.azure.com) and navigate to **Microsoft Defender for Cloud**
2. In the left menu, select **Workbooks**
3. Click **+ New** in the top toolbar
4. Click the **Advanced Editor** button (`</>`) in the toolbar
5. Delete all existing content in the editor
6. Open [`defender-coverage-workbook.json`](./defender-coverage-workbook.json), copy the entire contents, and paste it into the editor
7. Click **Apply** then **Save**
8. Give the workbook a name (e.g. `Defender Coverage`) and choose a subscription and resource group to save it to
9. Click **Save**

The workbook will now appear in your **Defender for Cloud → Workbooks** gallery.

### Option 2 — Import via Azure Monitor Workbooks

1. Navigate to **Azure Monitor** → **Workbooks**
2. Click **+ New**
3. Follow steps 4–9 above

### Option 3 — Deploy via Azure CLI

```bash
# Replace the placeholder values before running
SUBSCRIPTION_ID="<your-subscription-id>"
RESOURCE_GROUP="<your-resource-group>"
LOCATION="<your-location>"          # e.g. eastus
WORKBOOK_ID=$(uuidgen)              # or any valid GUID

az resource create \
  --resource-group "$RESOURCE_GROUP" \
  --resource-type "microsoft.insights/workbooks" \
  --name "$WORKBOOK_ID" \
  --location "$LOCATION" \
  --properties "{
    \"displayName\": \"Defender Coverage\",
    \"serializedData\": $(cat defender-coverage-workbook.json | jq -Rs .),
    \"version\": \"1.0\",
    \"category\": \"workbook\",
    \"sourceId\": \"/subscriptions/$SUBSCRIPTION_ID\"
  }"
```

> Requires [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli) and [jq](https://stedolan.github.io/jq/).

---

## Usage

1. Open the workbook in the portal
2. Use the **Subscriptions** pill filter at the top to scope the view to one, several, or all subscriptions
3. Use the **Recommendation Severity** filter to scope the Top 10 recommendations grid in Executive Summary
4. Click each tab to explore the corresponding view
5. On the **Protection Gaps** tab:
   - **Stopped column** shows deallocated (powered-off) Azure VMs — these are included in the Total count
   - **Power State column** in the unprotected servers list shows whether each server is running or deallocated
    - **Resource Manager (Arm)** is subscription-scoped, so its Total/Protected/Unprotected values represent subscription counts
6. On the **Regulatory Compliance** tab, review low-compliance standards and governance blind spots first
7. Use the **Export to Excel** button (available on most grids) to export data for reporting
8. Click column headers in any grid to sort

---

## How it works

All data comes from **Azure Resource Graph** — no agents, no Log Analytics workspace, no extra cost. The queries target two resource types:

| ARG table | Used for |
|---|---|
| `securityresources` | Secure scores, Defender plan status, extension on/off state |
| `resources` | Counting actual resources (VMs, storage accounts, etc.) for coverage gap calculations |
| `resourcecontainers` | Resolving subscription IDs to friendly subscription names and producing subscription-scoped counts for CSPM and Resource Manager |

### Secure Score deduplication
Uses a canonical ID match to avoid management-group-scoped duplicates:
```kql
| where tolower(id) == tolower(strcat("/subscriptions/", subscriptionId, "/providers/microsoft.security/securescores/ascscore"))
| summarize arg_min(id, *) by subscriptionId
```

### Pricing deduplication
Defender plan queries use a canonical pricing ID filter and tier-based ranking to avoid counting duplicate rows from Azure Resource Graph:
```kql
| where pricingId == tolower(strcat("/subscriptions/", subscriptionId, "/providers/microsoft.security/pricings/", planName))
| extend tierRank = case(pricingTier == "Standard", 2, pricingTier == "Free", 1, 0)
| summarize arg_max(tierRank, *) by subscriptionId, planName
```
This ensures Standard-tier plans take precedence over Free, and prevents duplicate rows from inflating resource counts.

### Deallocated VM handling
The workbook includes **deallocated (powered-off) Azure VMs** in resource counts because they:
- Still consume compute capacity reservations
- Are subject to Defender for Cloud licensing
- Represent blind spots if not protected

A **Stopped** column in the Protection Gaps tab breaks this out separately so you can see the split between running and deallocated VMs at a glance.

---

## Extension ARG key reference

### Defender CSPM (`CloudPosture`)
| Portal label | ARG key |
|---|---|
| Agentless scanning for machines | `AgentlessVmScanning` |
| Kubernetes API access | `AgentlessDiscoveryForKubernetes` |
| Registry access | `ContainerRegistriesVulnerabilityAssessments` |
| Sensitive data threat detection | `SensitiveDataDiscovery` |
| CIEM | `EntraPermissionsManagement` |
| API Security Posture Management | `ApiSecurityPostureManagement` |
| Serverless protection | `ServerlessProtection` |

### Defender for Servers (`VirtualMachines`)
| Portal label | ARG key |
|---|---|
| Log Analytics agent | `MmaAgent` |
| Vulnerability assessment | `MdeVulnerabilityAssessment` |
| Guest Configuration agent | `GuestConfiguration` |
| Endpoint protection | `MdeDesignatedSubscription` |
| Agentless scanning for machines | `AgentlessVmScanning` |
| File Integrity Monitoring | `FileIntegrityMonitoring` |

### Defender for Containers (`Containers`)
| Portal label | ARG key |
|---|---|
| Agentless scanning for machines | `AgentlessVmScanning` |
| Defender sensor | `DefenderDaemonSet` |
| Azure Policy | `AzurePolicy` |
| Kubernetes API access | `AgentlessDiscoveryForKubernetes` |
| Registry access | `ContainerRegistriesVulnerabilityAssessments` |

### Defender for Storage (`StorageAccounts`)
| Portal label | ARG key |
|---|---|
| Malware scanning | `OnUploadMalwareScanning` |
| Sensitive data discovery | `SensitiveDataDiscovery` |

### Defender for AI (`AI`)
| Portal label | ARG key |
|---|---|
| Suspicious Prompt Evidence | `SuspiciousPromptEvidence` |
| Data Security for AI | `DataSecurityForAIInteractions` |
| AI Model Security (Preview) | `AIModelSecurity` |

---

## Troubleshooting

**Extensions show blank instead of On/Off**
The ARG key name for that extension may differ in your tenant. Run the following query in [Azure Resource Graph Explorer](https://portal.azure.com/#blade/HubsExtension/ArgQueryBlade) to find the actual key names:
```kql
securityresources
| where type =~ "microsoft.security/pricings" and name =~ "CloudPosture"
| mv-expand ext = properties.extensions
| project subscriptionId, extName = tostring(ext.name), isEnabled = tostring(ext.isEnabled)
| distinct extName
```
Replace `CloudPosture` with the plan name you're investigating (`VirtualMachines`, `Containers`, etc.).

**Secure Score shows 0 or is missing**
Secure Score may take up to 24 hours to populate in a newly onboarded subscription.

**No data appears at all**
Ensure you have at least **Reader** access to the selected subscriptions and that Defender for Cloud has been accessed at least once in each subscription to initialise the resource graph entries.

---

## Disclaimer

This workbook is provided for **informational purposes only** to assist with visibility into your security posture. The data is sourced from Azure Resource Graph and Microsoft Defender for Cloud APIs and may be incomplete, delayed, or inaccurate. No legal rights, compliance certifications, or security guarantees of any kind can be derived from the information displayed here. Always verify findings through official channels before taking action.

---

## Contributing

Pull requests welcome. When editing the workbook JSON:
1. Validate the JSON before committing: `Get-Content defender-coverage-workbook.json | ConvertFrom-Json`
2. Test the workbook in the portal before pushing

---

## About

Created by **Rhesa Baar**
