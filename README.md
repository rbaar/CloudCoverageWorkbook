# Defender for Cloud — Security Coverage Workbook

An Azure Monitor Workbook that answers **"How well is the cloud estate protected?"** in a single view. It uses Azure Resource Graph to surface Defender for Cloud data across all your subscriptions without requiring a Log Analytics workspace.

Current workbook version: **v1.2** (2026-11-05)

The workbook reports **subscription-plan enablement**, not verified resource-level protection. Resource overrides, exclusions, feature onboarding, and runtime sensor health are not evaluated. Missing data is shown as **Unknown**, not as a disabled plan or a zero score.

---

## What's in the workbook

| Tab | What it shows |
|---|---|
| **Executive Summary** | Average of available Secure Scores with scored/total subscription counts, all visible subscriptions in scope, subscriptions with known pricing but no Standard plans, and subscriptions with all 14 included plans on. Missing/unrecognized pricing appears separately in the detail table. Top 10 recommendations retain the High/Medium severity filter. |
| **Secure Score per Subscription** | Grid retaining subscriptions with missing scores as Unknown; chart of available scores only. Current/max points and optional resource counts are blank when absent. |
| **Protection Gaps** | Inventory under enabled, disabled, or unknown subscription plans, using identical summary-table, chart, and subscription-detail populations. SQL servers/managed instances, registered SQL VM resources, and open-source databases are separate workloads. **CSPM and Resource Manager count subscriptions**; other rows count resources. Stopped VMs are a subset, not an additional chart series. |
| **Plan Status per Subscription** | Fixed 14-column plan catalogue with On/Off/Unknown and sub-plan details. Includes subscriptions without pricing data and legacy DNS for visibility; all 14 plans on is not a recommendation or a measure of applicable workload coverage. |
| **Extensions & Features** | Exact, case-insensitive extension-key matching with On/Off/Unknown states. Subscriptions with missing plan records or empty extension arrays remain visible. |
| **Regulatory Compliance** | Clearly separated **Compliance result** (for example, Failed) and **Data status** (for example, Available) columns, control counts, and compliance percentages. Governance context uses the same no-Standard/unknown-pricing classification as the Executive Summary; missing standards or failed-control counts are not zero. |

---

## Prerequisites

- **Azure subscription(s)** visible to your identity; subscriptions without Defender pricing data remain in scope, although Defender-specific views may show Unknown or no results
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

Click **Done Editing** to leave edit mode. In edit mode, messages such as "This group is not visible" are expected for unselected tabs; they are not query errors.

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
   - **Power State column** in the server detail list shows whether each server is running, deallocated, or unknown
   - **Under enabled plan / Under disabled plan / Unknown plan status** sum to Total; the percentage includes unknown inventory in the denominator
   - **CSPM and Resource Manager (Arm)** are subscription-scoped; check the Count unit before comparing rows
   - Do not sum workload rows: units differ and a VM may also have a registered SQL VM resource
6. On the **Regulatory Compliance** tab, review low-compliance standards and governance blind spots first
7. Use the **Export to Excel** button (available on most grids) to export data for reporting
8. Click column headers in any grid to sort

---

## How it works

All displayed data comes from **Azure Resource Graph**; the workbook itself requires no agents or Log Analytics workspace. The queries use three tables:

| ARG table | Used for |
|---|---|
| `securityresources` | Secure scores, Defender plan status, extension configuration, and compliance results |
| `resources` | Counting workload inventory (VMs, storage accounts, etc.) for plan-enablement calculations |
| `resourcecontainers` | Defining the visible subscription population, resolving names, and producing subscription-scoped counts for CSPM and Resource Manager |

Subscription-based views start from `resourcecontainers`, not pricing records. Coverage queries combine a zero-count subscription/workload scaffold with resource inventory, then left-join pricing. This retains subscriptions with no pricing records and workload rows with no resources. Total reflects the subscriptions returned to your identity, not a guarantee of tenant-wide visibility.

### Secure Score deduplication
Uses a canonical ID match to avoid management-group-scoped duplicates:
```kql
| extend subId = tolower(subscriptionId)
| where tolower(id) == strcat("/subscriptions/", subId, "/providers/microsoft.security/securescores/ascscore")
| summarize arg_min(id, *) by subId
```

### Pricing deduplication
Defender plan queries use a canonical pricing ID filter and tier-based ranking to avoid counting duplicate rows from Azure Resource Graph:
```kql
| extend subId = tolower(subscriptionId), planName = tolower(name), pricingId = tolower(id), pricingTier = tostring(properties.pricingTier)
| where pricingId == strcat("/subscriptions/", subId, "/providers/microsoft.security/pricings/", planName)
| extend tierRank = case(pricingTier =~ "Standard", 2, pricingTier =~ "Free", 1, 0)
| summarize arg_max(tierRank, *) by subId, planName
```
This ensures Standard-tier plans take precedence over Free, and prevents duplicate rows from inflating resource counts. The no-plan KPI and tables use this same ranking. An unrecognized tier is Unknown, never automatically On or Off.

### Interpreting missing data

- A missing/invalid Secure Score is Unknown. The average excludes it and explicitly shows the scored/total subscription count.
- A missing/unrecognized pricing record makes associated inventory Unknown. No inventory produces a null percentage and an explicit N/A status.
- A missing extension key or invalid boolean is Unknown. Exact keys are listed below; broad name-fragment matching is not used.
- Missing compliance counts are Unknown; zero evaluated controls is N/A. Missing standards data does not prove that no standards are assigned.
- Legacy DNS and legacy extension columns are retained for visibility, not as a list of features that every subscription should enable.

### Workload mapping

SQL servers and managed instances map to `SqlServers`; registered `microsoft.sqlvirtualmachine/sqlvirtualmachines` resources map to `SqlServerVirtualMachines`; PostgreSQL, MySQL, and legacy MariaDB server resources map to `OpenSourceRelationalDatabases`. The workbook counts parent server/resource inventory, not individual databases or actual protected SQL installations.

AKS clusters/ACR registries, AI service/workspace resources, and API Management instances are inventory proxies. A Standard subscription plan does not establish that each cluster, model, or API is onboarded.

### Deallocated VM handling
The workbook includes **deallocated Azure VMs** because they remain resources in Resource Graph. The power-state code `PowerState/deallocated` identifies the Stopped subset. This workbook does not determine compute allocation, capacity reservations, or Defender billing eligibility.

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

**Extensions show Unknown**
The plan, extension key, or boolean value may be absent, unsupported, or different from the workbook's known keys. Unknown is not Off. Run the following query in [Azure Resource Graph Explorer](https://portal.azure.com/#blade/HubsExtension/ArgQueryBlade) to inspect the actual names and values:
```kql
securityresources
| where type =~ "microsoft.security/pricings" and name =~ "CloudPosture"
| mv-expand ext = properties.extensions
| project subscriptionId, extName = tostring(ext.name), isEnabled = tostring(ext.isEnabled)
| distinct extName
```
Replace `CloudPosture` with the plan name you're investigating (`VirtualMachines`, `Containers`, etc.). Only add an explicit key alias after verifying its meaning; do not infer feature state from partial name matches.

**Secure Score is Unknown**
The score may not have populated yet, may not be visible to your identity, or may be absent from the Resource Graph response. Unknown is excluded from the average and chart but retained in the subscription table.

**No data appears at all**
Ensure you have at least **Reader** access to the selected subscriptions and that Defender for Cloud has been accessed at least once in each subscription to initialise the resource graph entries.

---

## Disclaimer

This workbook is provided for **informational purposes only** to assist with visibility into your security posture. The data is sourced from Azure Resource Graph and Microsoft Defender for Cloud APIs and may be incomplete, delayed, or inaccurate. No legal rights, compliance certifications, or security guarantees of any kind can be derived from the information displayed here. Always verify findings through official channels before taking action.

---

## Contributing

Pull requests welcome. When editing the workbook JSON:
1. Validate the JSON before committing: `Get-Content defender-coverage-workbook.json | ConvertFrom-Json`
2. Run offline regression checks with Node.js: `node --test tests\workbook.test.cjs`
3. Test the workbook in the portal before pushing. Offline checks do not execute Resource Graph queries.

### Portal acceptance checklist

Import into a **new test workbook** rather than overwriting your existing saved workbook. Apply the JSON, leave edit mode, and check:

1. Executive Summary renders its content; every tab selects the correct group. Hidden-group messages appear only in edit mode.
2. One-subscription and All filters change every view consistently; High/Medium still filters recommendations.
3. Total subscriptions matches the visible selected scope. Subscriptions without pricing appear as Unknown, not silently omitted or counted as known no-plan subscriptions.
4. SQL, SQL on VMs, and open-source database rows use their respective plans. With mixed plan settings, the table, chart, and subscription breakdown agree.
5. For each coverage row, enabled + disabled + unknown equals Total. No-resource rows are N/A. Stopped is a subset of VM Total and is not added to the chart totals.
6. Missing scores and empty/missing extension arrays retain their subscriptions with Unknown states. Known extension On/Off values match the observed ARG keys.
7. Compliance Unknown/N/A values are not plotted as 0% or -1%. Missing standards data or failed-control counts do not appear as verified zero.

---

## About

Created by **Rhesa Baar**
