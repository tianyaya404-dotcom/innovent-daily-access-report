import nodemailer from "nodemailer";
import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000,
  headers: {
    "user-agent": "Mozilla/5.0 Codex Daily Report Bot"
  }
});

const REQUIRED_ENV = ["GMAIL_USER", "GMAIL_APP_PASSWORD", "REPORT_TO"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required env: ${key}`);
  }
}

const TZ = process.env.REPORT_TZ || "Asia/Shanghai";
const NOW = new Date();
const REPORT_DATE = formatDate(NOW, TZ);
const SUBJECT = `信达准入与价格治理日报 - ${REPORT_DATE}`;
const LOOKBACK_HOURS = 96;

const COMPANY_KEYWORDS = [
  "信达生物",
  "Innovent",
  "达伯舒",
  "信迪利单抗",
  "IBI363",
  "IBI343",
  "IBI310",
  "IBI112",
  "托莱西单抗"
];

const COMPETITOR_KEYWORDS = [
  "恒瑞医药",
  "百济神州",
  "君实生物",
  "复宏汉霖",
  "康方生物",
  "荣昌生物",
  "石药集团",
  "翰森制药",
  "科伦博泰",
  "百奥泰",
  "阿斯利康",
  "罗氏",
  "BMS",
  "默沙东"
];

const PRICE_POLICY_KEYWORDS = [
  "医保",
  "医保目录",
  "国谈",
  "谈判",
  "挂网",
  "招标",
  "集采",
  "带量采购",
  "价格治理",
  "支付标准",
  "双通道",
  "惠民保",
  "商保"
];

const BIOSIMILAR_KEYWORDS = [
  "生物类似药",
  "阿达木单抗",
  "贝伐珠单抗",
  "利妥昔单抗",
  "曲妥珠单抗",
  "帕妥珠单抗",
  "英夫利西单抗"
];

const NOVEL_DRUG_KEYWORDS = [
  "1类新药",
  "创新药",
  "受理",
  "获批",
  "III期",
  "临床",
  "适应症",
  "上市申请"
];

const FEEDS = [
  {
    name: "Google News - 信达生物",
    url: googleNewsRss("信达生物 OR Innovent OR 达伯舒 OR 信迪利单抗")
  },
  {
    name: "Google News - 重点竞品",
    url: googleNewsRss("恒瑞医药 OR 百济神州 OR 君实生物 OR 复宏汉霖 OR 康方生物 OR 荣昌生物 OR 石药集团 OR 翰森制药 OR 科伦博泰 OR 百奥泰")
  },
  {
    name: "Google News - 医保挂网集采",
    url: googleNewsRss("医保 挂网 集采 价格治理 生物类似药 创新药")
  },
  {
    name: "Google News - 生物类似药",
    url: googleNewsRss("生物类似药 挂网 参照药 集采")
  },
  {
    name: "Google News - 肿瘤与代谢赛道",
    url: googleNewsRss("PD-1 OR HER2 OR TROP2 OR GLP-1 医保 挂网 获批")
  }
];

async function main() {
  const rawItems = await fetchFeedItems();
  const shortlisted = shortlist(rawItems);
  const sections = buildSections(shortlisted);
  const body = buildEmailBody(sections, shortlisted);
  await sendEmail(SUBJECT, body);
  console.log(`Sent ${SUBJECT} with ${shortlisted.length} items`);
}

async function fetchFeedItems() {
  const all = [];
  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items || []) {
        all.push(normalizeItem(item, feed.name));
      }
    } catch (error) {
      all.push({
        title: `${feed.name} 抓取失败`,
        link: feed.url,
        isoDate: NOW.toISOString(),
        source: feed.name,
        summary: String(error.message || error),
        categories: ["抓取失败"],
        score: -1,
        uncertainty: "高"
      });
    }
  }
  return dedupe(all).filter((item) => withinLookback(item.isoDate, LOOKBACK_HOURS));
}

function normalizeItem(item, source) {
  const text = [item.title, item.contentSnippet, item.content, item.summary]
    .filter(Boolean)
    .join(" ");
  const score = scoreItem(text);
  return {
    title: sanitize(item.title || "无标题"),
    link: item.link || "",
    isoDate: item.isoDate || item.pubDate || NOW.toISOString(),
    source: sourceFromLink(item.link) || source,
    summary: sanitize(item.contentSnippet || item.summary || ""),
    categories: categorize(text),
    score,
    uncertainty: inferUncertainty(item.link || "", source)
  };
}

function shortlist(items) {
  return items
    .filter((item) => item.score >= 1)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.isoDate) - new Date(a.isoDate);
    })
    .slice(0, 36);
}

function buildSections(items) {
  const innovent = items.filter((item) => item.categories.includes("信达"));
  const competitors = items.filter((item) => item.categories.includes("竞品"));
  const biosimilar = items.filter((item) => item.categories.includes("生物类似药"));
  const novelDrug = items.filter((item) => item.categories.includes("1类新药"));
  const policy = items.filter((item) => item.categories.includes("医保招采"));

  return {
    conclusions: buildConclusions({ innovent, competitors, biosimilar, novelDrug, policy }),
    innovent,
    competitors,
    biosimilar,
    novelDrug,
    relation: buildRelations(items),
    policyTips: buildPolicyTips(policy, items),
    studyQuestions: buildStudyQuestions(items),
    checklist: buildChecklist(items)
  };
}

function buildEmailBody(sections, items) {
  const lines = [];
  lines.push("信达准入与价格治理日报");
  lines.push(`日期：${REPORT_DATE}`);
  lines.push("说明：基于公开新闻 RSS/搜索源自动整理，属于云端版本最小可用稿；请对关键结论再核验官方原文。");
  lines.push("");
  lines.push("一、今日结论");
  lines.push(...formatBulletLines(sections.conclusions));
  lines.push("");
  lines.push("二、信达准入动态");
  lines.push(...formatItemSection(sections.innovent, "今天未抓到高相关的信达新增公开信息，建议重点复核官网新闻、IR 和 NMPA/CDE。"));
  lines.push("");
  lines.push("三、竞品与价格动态");
  lines.push(...formatItemSection(sections.competitors, "今天未抓到足够高相关的竞品动态。"));
  lines.push("");
  lines.push("四、生物类似药跟踪");
  lines.push(...formatItemSection(sections.biosimilar, "今天未抓到足够高相关的生物类似药新增动态。"));
  lines.push("");
  lines.push("五、1类生物新药跟踪");
  lines.push(...formatItemSection(sections.novelDrug, "今天未抓到足够高相关的1类生物新药新增动态。"));
  lines.push("");
  lines.push("六、产品/靶点/适应症关联");
  lines.push(...formatBulletLines(sections.relation));
  lines.push("");
  lines.push("七、招采/医保/价格治理提示");
  lines.push(...formatBulletLines(sections.policyTips));
  lines.push("");
  lines.push("八、需要重点学习的问题");
  lines.push(...formatBulletLines(sections.studyQuestions));
  lines.push("");
  lines.push("九、今日学习打卡");
  lines.push(...formatBulletLines(sections.checklist));
  lines.push("");
  lines.push("最后提醒");
  lines.push("请打开信达生物产品学习计划页面，并回复今天准备学习哪些产品、昨天完成了哪些打卡项、还有哪些问题。");
  lines.push("");
  lines.push("附：今日纳入候选信息源");
  lines.push(...items.slice(0, 12).map((item, index) => `${index + 1}. ${item.title} | ${formatItemMeta(item)}`));
  return lines.join("\n");
}

function buildConclusions(groups) {
  const output = [];
  if (groups.policy.length) {
    output.push(`今天政策/价格治理相关信息最多（${groups.policy.length}条），建议优先判断是否涉及医保、挂网、集采、支付标准和院端采购规则变化。`);
  }
  if (groups.innovent.length) {
    output.push(`信达相关高相关信息 ${groups.innovent.length} 条，优先核对是否落在上市产品、临床注册、医保申报或商业化准入节点。`);
  } else {
    output.push("今天公开源里未见明显新增的信达重磅准入信息，工作重点应转向竞品、政策和价格规则对信达的外部影响。");
  }
  if (groups.biosimilar.length) {
    output.push(`生物类似药线索 ${groups.biosimilar.length} 条，需要特别复核参照药价格、省级挂网联动和潜在集采影响。`);
  }
  if (groups.novelDrug.length) {
    output.push(`创新药/1类新药线索 ${groups.novelDrug.length} 条，建议同步看医保申报资格、商保路径和预算影响。`);
  }
  return output.slice(0, 4);
}

function buildRelations(items) {
  const foundTargets = extractKeywords(items, ["PD-1", "HER2", "TROP2", "GLP-1", "VEGF", "ADC"]);
  const foundDiseases = extractKeywords(items, ["肺癌", "乳腺癌", "胃癌", "结直肠癌", "肝癌", "银屑病"]);
  const lines = [];
  if (foundTargets.length) {
    lines.push(`今日高频靶点/机制：${foundTargets.join("、")}。做准入对比时，建议按同靶点、同适应症、同治疗线数拆分证据。`);
  } else {
    lines.push("今日抓取结果未形成单一高频靶点，建议继续按 PD-1、HER2、TROP2、GLP-1 四条主线维护长期对比表。");
  }
  if (foundDiseases.length) {
    lines.push(`今日高频适应症：${foundDiseases.join("、")}。院端准入分析要同步比较销售科室、患者支付能力和现有替代方案。`);
  }
  lines.push("对生物类似药，优先建立“参照药价格-新增竞品-挂网规则-院端替代路径”的四列跟踪表。");
  return lines;
}

function buildPolicyTips(policyItems, items) {
  const lines = [];
  if (policyItems.length) {
    lines.push("有医保/挂网/集采/价格治理相关新闻时，先核查是否来自国家医保局、省级医保局或药械采购平台，避免被二手解读带偏。");
  }
  if (items.some((item) => containsAny(item.title + item.summary, ["挂网", "价格"])) ) {
    lines.push("凡是出现挂网、价格联动、支付标准相关表述，都要补做“省份-执行日期-是否追溯历史挂网价”的落地表。");
  }
  lines.push("云端版日报优先保证连续发送；关键结论建议再回到官方公告、企业官网和 NMPA/CDE 页面复核。");
  return lines;
}

function buildStudyQuestions(items) {
  const lines = [];
  lines.push("今天出现的竞品里，哪些与信达属于同靶点、同适应症、同治疗线数竞争？");
  lines.push("若相关产品年内可能进医保，参照药、支付标准、预算影响该如何建模？");
  if (items.some((item) => item.categories.includes("生物类似药"))) {
    lines.push("涉及生物类似药的品种里，是否存在参照药价格锚点、红黄标预警或价格联动风险？");
  }
  lines.push("今天是否需要把某个产品补进“院端准入与挂网规则”长期跟踪表？");
  return lines;
}

function buildChecklist(items) {
  const lines = [];
  lines.push("补一页信达重点产品清单：靶点、适应症、治疗线、医保状态、挂网状态。");
  lines.push("从今日信息里挑 1 个竞品，写 3 句话说明它对信达市场准入的直接影响。");
  if (items.some((item) => item.categories.includes("医保招采"))) {
    lines.push("把今天出现的政策或挂网信息抄进“省份/规则/影响/待验证”表。");
  } else {
    lines.push("今天复盘一条历史医保或挂网规则，练习把政策语言翻成市场准入动作。");
  }
  return lines;
}

function formatItemSection(items, fallback) {
  if (!items.length) return [fallback];
  return items.slice(0, 6).flatMap((item, index) => {
    const lines = [];
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(`   影响判断：${impactHint(item)}`);
    lines.push(`   日期/来源/不确定性：${formatItemMeta(item)}`);
    lines.push(`   链接：${item.link || "无"}`);
    return lines;
  });
}

function formatBulletLines(lines) {
  return lines.map((line, index) => `${index + 1}. ${line}`);
}

function impactHint(item) {
  const text = `${item.title} ${item.summary}`;
  if (containsAny(text, ["医保", "目录", "国谈", "支付标准"])) {
    return "可能直接影响医保准入、支付标准或谈判策略，建议尽快核对适用品种和时间点。";
  }
  if (containsAny(text, ["挂网", "采购", "集采", "价格"])) {
    return "可能影响省级挂网、医院采购和价格联动，建议补做省份和执行口径核验。";
  }
  if (containsAny(text, ["获批", "受理", "III期", "临床"])) {
    return "可能改变竞品上市节奏和准入准备顺序，建议纳入同靶点/同适应症对比表。";
  }
  return "属于需跟踪的公开动态，建议先判断其是否会外溢到医保、挂网或院端准入。";
}

function formatItemMeta(item) {
  return `${formatDate(new Date(item.isoDate), TZ)} | ${item.source} | 不确定性${item.uncertainty}`;
}

function scoreItem(text) {
  let score = 0;
  if (containsAny(text, COMPANY_KEYWORDS)) score += 4;
  if (containsAny(text, COMPETITOR_KEYWORDS)) score += 3;
  if (containsAny(text, PRICE_POLICY_KEYWORDS)) score += 3;
  if (containsAny(text, BIOSIMILAR_KEYWORDS)) score += 2;
  if (containsAny(text, NOVEL_DRUG_KEYWORDS)) score += 2;
  return score;
}

function categorize(text) {
  const tags = [];
  if (containsAny(text, COMPANY_KEYWORDS)) tags.push("信达");
  if (containsAny(text, COMPETITOR_KEYWORDS)) tags.push("竞品");
  if (containsAny(text, PRICE_POLICY_KEYWORDS)) tags.push("医保招采");
  if (containsAny(text, BIOSIMILAR_KEYWORDS)) tags.push("生物类似药");
  if (containsAny(text, NOVEL_DRUG_KEYWORDS)) tags.push("1类新药");
  return tags;
}

function containsAny(text, keywords) {
  const haystack = String(text || "").toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function extractKeywords(items, keywords) {
  return keywords.filter((keyword) => items.some((item) => containsAny(`${item.title} ${item.summary}`, [keyword])));
}

function sourceFromLink(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function googleNewsRss(query) {
  const encoded = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${encoded}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
}

function sanitize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.title}::${item.link}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferUncertainty(link, source) {
  const host = `${source} ${link}`.toLowerCase();
  if (containsAny(host, ["nhsa.gov.cn", "nmpa.gov.cn", "cde.org.cn", "gov.cn"])) return "低";
  if (containsAny(host, ["innoventbio", "henlius", "akesobio", "beigene", "hengrui", "junshipharma", "kelun-biotech"])) return "低";
  if (containsAny(host, ["yicai", "stcn", "pharmcube", "36kr", "cls"])) return "中";
  return "中";
}

function withinLookback(isoDate, hours) {
  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) return false;
  return NOW.getTime() - ts <= hours * 60 * 60 * 1000;
}

function formatDate(date, timeZone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(date)
    .replace(/\//g, "-");
}

async function sendEmail(subject, body) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.REPORT_TO,
    subject,
    text: body
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
