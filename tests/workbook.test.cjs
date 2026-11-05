const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workbook = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'defender-coverage-workbook.json'), 'utf8'));
const items = new Map();
function visit(list) {
  for (const item of list) {
    assert(!items.has(item.name), `Duplicate item name: ${item.name}`);
    items.set(item.name, item);
    if (item.type === 12) visit(item.content.items);
  }
}
visit(workbook.items);
const query = name => items.get(name).content.query;

test('all six tab groups use the editable schema value and match tab targets', () => {
  const groups = workbook.items.filter(item => item.type === 12);
  const targets = items.get('tabs').content.links.map(link => link.subTarget);
  assert.equal(groups.length, 6);
  assert.deepEqual(groups.map(group => group.conditionalVisibility.value), targets);
  for (const group of groups) {
    assert.equal(group.content.groupType, 'editable');
    assert.equal(group.conditionalVisibility.parameterName, 'selectedTab');
    assert(group.content.items.length > 0);
  }
});

test('all queries retain the subscription filter and ARG datasource', () => {
  const queries = [...items.values()].filter(item => item.type === 3);
  assert.equal(queries.length, 21);
  for (const item of queries) {
    assert.equal(item.content.queryType, 1, item.name);
    assert.equal(item.content.resourceType, 'microsoft.resourcegraph/resources', item.name);
    assert.deepEqual(item.content.crossComponentResources, ['{Subscriptions}'], item.name);
    assert((item.content.query.match(/\|\s*(?:join|union)\b/g) ?? []).length <= 3, item.name);
    assert((item.content.query.match(/\|\s*mv-expand\b/g) ?? []).length <= 3, item.name);
  }
  assert(query('top-recommendations-grid').includes('severity in~ ({Severity})'));
});

test('coverage table and chart use identical populations and aggregation', () => {
  const table = query('coverage-gap-table');
  assert.equal(query('coverage-gap-chart'), `${table}\n| project DisplayName, PlanOn, PlanOff, Unknown`);
  const inventory = table.slice(0, table.indexOf('\n| summarize TotalResources'));
  assert(query('drill-table').startsWith(`${inventory}\n| where ResourceCount > 0 and PlanStatus != "On"`));
  assert(table.includes('Unknown = sumif(ResourceCount, PlanStatus == "Unknown")'));
  assert(table.includes('PlanOnPct = iff(TotalResources > 0'));
  assert(table.includes('real(null)'));
  assert(!table.includes('Protected'));
  assert.deepEqual(items.get('coverage-gap-chart').content.chartSettings.yAxis, ['PlanOn', 'PlanOff', 'Unknown']);
});

test('SQL, SQL VM and OSS resource fixtures map to separate plans in all coverage views', () => {
  const fixtures = [
    ['microsoft.sql/servers', 'sqlservers'],
    ['microsoft.sql/managedinstances', 'sqlservers'],
    ['microsoft.sqlvirtualmachine/sqlvirtualmachines', 'sqlservervirtualmachines'],
    ['microsoft.dbforpostgresql/flexibleservers', 'opensourcerelationaldatabases'],
    ['microsoft.dbformysql/flexibleservers', 'opensourcerelationaldatabases'],
    ['microsoft.dbforpostgresql/servers', 'opensourcerelationaldatabases'],
    ['microsoft.dbformysql/servers', 'opensourcerelationaldatabases'],
    ['microsoft.dbformariadb/servers', 'opensourcerelationaldatabases'],
    ['MICROSOFT.COMPUTE/VIRTUALMACHINES', 'virtualmachines'],
    ['microsoft.hybridcompute/machines', 'virtualmachines'],
  ];
  for (const name of ['coverage-gap-table', 'coverage-gap-chart', 'drill-table']) {
    const mappings = [...query(name).matchAll(/type\s+(in~|=~)\s+(\([^)]*\)|"[^"]*"),\s*"([^"]*)"/g)]
      .map(([, , values, plan]) => [values.match(/"[^"]*"/g).map(value => JSON.parse(value).toLowerCase()), plan]);
    for (const [type, expectedPlan] of fixtures) {
      assert.equal(mappings.find(([types]) => types.includes(type.toLowerCase()))?.[1], expectedPlan, `${name}: ${type}`);
    }
  }
});

test('all workload rows are scaffolded and subscription-scoped plans have explicit units', () => {
  const text = query('coverage-gap-table');
  const plans = JSON.parse(text.match(/planCategories = dynamic\((\[[^\n]*\])\)/)[1]);
  assert.equal(plans.length, 13);
  assert(plans.includes('arm') && plans.includes('cloudposture') && plans.includes('opensourcerelationaldatabases'));
  assert(text.startsWith('resourcecontainers'));
  assert(text.includes('| union ('));
  assert(text.includes('arg_max(nameRank, Subscription)'));
  assert(text.includes('Unit = iff(planName in ("cloudposture", "arm"), "Subscriptions", "Resources")'));
  assert(text.includes('| join kind=leftouter ('));
});

test('subscription KPIs and no-plan views separate unknown pricing from known Free tiers', () => {
  for (const name of ['kpi-total-subs', 'kpi-no-plan', 'kpi-full-coverage', 'no-plan-grid', 'rc-governance-gap-grid', 'plans-overview-grid']) {
    assert(query(name).startsWith('resourcecontainers'), name);
  }
  assert(query('kpi-no-plan').includes('countif(PlanStatus == "No Standard plans")'));
  const classification = '| extend PricingDataStatus = case(TotalPlansEvaluated == 0, "No pricing data",\n' +
    '                                 UnknownPlans > 0, "Unknown pricing tier", "Available")\n' +
    '| extend PlanStatus = case(StandardPlans > 0, "One or more plans on",\n' +
    '                          PricingDataStatus != "Available", "Unknown", "No Standard plans")';
  assert(query('no-plan-grid').includes(classification));
  assert(query('rc-governance-gap-grid').includes(classification));
  assert.equal((query('rc-governance-gap-grid').match(/\|\s*join\b/g) ?? []).length, 1);
  for (const name of ['kpi-no-plan', 'kpi-full-coverage', 'no-plan-grid', 'rc-governance-gap-grid']) {
    assert(query(name).includes('summarize arg_max(tierRank, *)'), name);
  }
  assert(query('kpi-full-coverage').includes('Subs with all 14 included plans on'));
  assert(!query('kpi-full-coverage').includes('full Defender coverage'));
});

test('Secure Score missing data is not zero and the KPI exposes sample coverage', () => {
  for (const name of ['kpi-secure-score', 'score-grid', 'score-chart']) {
    assert(query(name).startsWith('resourcecontainers'), name);
    assert(query(name).includes('Unknown / no score data'), name);
    assert(!query(name).includes('coalesce(Score'), name);
  }
  assert(query('kpi-secure-score').includes('ScoredSubscriptions'));
  assert(query('kpi-secure-score').includes('TotalSubscriptions'));
  assert(query('kpi-secure-score').includes('Value = iff(isnull(Score), "Unknown"'));
  assert.equal(items.get('kpi-secure-score').content.tileSettings.leftContent.formatter, 1);
  assert(query('score-chart').includes('| where isnotnull(ScorePct)'));
});

test('extension views preserve empty arrays, use exact keys, and render Unknown separately', () => {
  const names = ['cspm-extensions-grid', 'servers-extensions-grid', 'containers-extensions-grid', 'storage-extensions-grid', 'ai-extensions-grid'];
  for (const name of names) {
    const text = query(name);
    assert(text.startsWith('resourcecontainers'), name);
    assert(text.includes('iff(array_length(properties.extensions) > 0, properties.extensions, dynamic([{}]))'), name);
    assert(text.includes('toint(tobool(ext.isEnabled))'), name);
    assert(!text.includes('extName contains'), name);
    assert(text.includes('int(null)'), name);
    assert(text.includes(', "Off", "Unknown")'), name);
    for (const formatter of items.get(name).content.gridSettings.formatters.filter(f => f.columnMatch !== 'Tier')) {
      const thresholds = formatter.formatOptions.thresholdsGrid;
      assert.equal(thresholds[0].thresholdValue, 'On');
      assert.equal(thresholds[1].thresholdValue, 'Off');
      assert.equal(thresholds.at(-1).text, '{0}');
      assert.equal(thresholds.at(-1).representation, 'warning');
    }
  }
});

test('compliance distinguishes unavailable counts and unevaluated percentages', () => {
  assert(query('rc-standards-grid').includes('"N/A - no evaluated controls"'));
  assert(query('rc-standards-grid').includes('ComplianceStatus'));
  assert(query('rc-chart').includes('| where isnotnull(pct)'));
  assert(query('rc-governance-gap-grid').includes('"No standards data"'));
  assert(query('rc-governance-gap-grid').includes('MissingFailedCounts == 0'));
  assert(!query('rc-governance-gap-grid').includes('coalesce(Standards, 0)'));
  for (const name of ['rc-standards-grid', 'rc-chart']) assert(!query(name).includes('todouble(-1)'));
});
