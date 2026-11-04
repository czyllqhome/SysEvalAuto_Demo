"""Versioned questionnaire and shared label dictionary. No I/O at import."""

QUESTIONNAIRE_VERSION = "classification-1"
MAPPING_VERSION = "classification-tags-1"
UNKNOWN = ("unknown", "待确认", None)
GROUPS = ["外网与部署", "数据处理情况", "业务连续性", "系统交互"]


def options(*items):
    return [{"value": value, "label": label, "tag": tag} for value, label, tag in items]


def yes_no(tag, negative):
    return options(("yes", "是", tag), ("no", "否", negative), UNKNOWN)


def field(key, label, choices=None):
    return {"key": key, "label": label, "options": choices}


def question(
    id,
    group,
    title,
    kind="single",
    choices=None,
    when=None,
    fields=None,
    details_when=None,
    hint="",
):
    return {
        "id": id,
        "group": group,
        "title": title,
        "kind": kind,
        "options": choices or [],
        "when": when or {},
        "fields": fields or [],
        "details_when": details_when,
        "hint": hint,
    }


PI = {"DATA-01": ["yes"]}
PROVIDED = options(("provided", "填写明细", None), UNKNOWN)
DEPLOYMENTS = options(
    ("public_cloud", "公有云", "deployment.public_cloud"),
    ("vendor_dc", "供应商机房", "deployment.vendor_dc"),
    ("own_dc", "自有机房", "deployment.own_dc"),
    ("other", "其他", "deployment.other"),
    UNKNOWN,
)

QUESTIONS = [
    question(
        "NET-01",
        0,
        "系统是否提供可通过互联网访问的入口？",
        choices=yes_no("network.internet_exposed", "network.no_internet_entry"),
        hint="需要登录的互联网入口也属于“是”。",
    ),
    question("DEP-01", 0, "系统未来部署在哪里？", "multi", DEPLOYMENTS),
    question(
        "DEP-02",
        0,
        "各部署环境所在的国家或地区是什么？",
        "deployment",
        fields=[
            field("region", "国家或地区（无法确定时填写：待确认）"),
            {
                "key": "provider",
                "label": "供应商或云服务商（选填）",
                "options": None,
                "optional": True,
            },
        ],
        hint="每个已选部署环境分别填写。",
    ),
    question(
        "DATA-01",
        1,
        "系统是否收集、存储、使用或传输个人信息？",
        choices=yes_no("data.personal", "data.no_personal"),
    ),
    question(
        "DATA-02",
        1,
        "涉及哪些个人信息？",
        "multi",
        options(
            ("name", "姓名", "data.personal.name"),
            ("contact", "联系方式", "data.personal.contact"),
            ("identity", "证件信息", "data.personal.identity"),
            ("account", "账号信息", "data.personal.account"),
            ("other", "其他", "data.personal.other"),
            UNKNOWN,
        ),
        when=PI,
    ),
    question(
        "DATA-03",
        1,
        "是否涉及敏感个人信息？",
        when=PI,
        choices=yes_no("data.sensitive_personal", "data.no_sensitive_personal"),
        hint="示例不是穷尽清单；无法判断时请选择待确认。",
    ),
    question(
        "DATA-04",
        1,
        "涉及哪些敏感个人信息？",
        "multi",
        options(
            ("biometric", "生物识别", "data.sensitive.biometric"),
            ("religion", "宗教信仰", "data.sensitive.religion"),
            ("identity", "特定身份", "data.sensitive.identity"),
            ("health", "医疗健康", "data.sensitive.health"),
            ("finance", "金融账户", "data.sensitive.finance"),
            ("location", "行踪轨迹", "data.sensitive.location"),
            ("children", "不满十四周岁未成年人个人信息", "data.children_under_14"),
            ("other", "其他", "data.sensitive.other"),
            UNKNOWN,
        ),
        when={**PI, "DATA-03": ["yes"]},
    ),
    question(
        "DATA-05",
        1,
        "是否委托其他组织处理个人信息？",
        when=PI,
        choices=yes_no("data.entrusted_processing", "data.no_entrusted_processing"),
        details_when=["yes"],
        fields=[field("party", "受托方"), field("purpose", "处理目的")],
    ),
    question(
        "DATA-06",
        1,
        "是否向其他个人信息处理者提供个人信息？",
        when=PI,
        choices=yes_no("data.external_provision", "data.no_external_provision"),
        details_when=["yes"],
        fields=[field("party", "接收方"), field("purpose", "提供目的")],
    ),
    question(
        "DATA-07",
        1,
        "是否公开披露个人信息？",
        when=PI,
        choices=yes_no("data.public_disclosure", "data.no_public_disclosure"),
    ),
    question(
        "DATA-08",
        1,
        "是否利用个人信息进行自动化决策？",
        when=PI,
        choices=yes_no("data.automated_decision", "data.no_automated_decision"),
    ),
    question(
        "DATA-09",
        1,
        "数据是否存在出境安排？",
        choices=yes_no("data.cross_border", "data.no_cross_border"),
        hint="包括非个人信息；不根据部署位置自动推断。",
    ),
    question(
        "DATA-10",
        1,
        "出境安排涉及哪些情况？",
        "multi",
        options(
            ("storage", "境外存储", "data.cross_border.storage"),
            ("transfer", "向境外传输", "data.cross_border.transfer"),
            ("access", "境外远程访问", "data.cross_border.remote_access"),
            ("other", "其他", "data.cross_border.other"),
            UNKNOWN,
        ),
        when={"DATA-09": ["yes"]},
        details_when="known",
        fields=[
            field("categories", "数据类别"),
            field("region", "接收国家或地区"),
            field("party", "接收方"),
            field("purpose", "目的"),
        ],
    ),
    question(
        "BIZ-01",
        2,
        "系统中断对业务有什么影响？",
        choices=options(
            ("none", "无明显影响", "business.no_material_impact"),
            ("efficiency", "效率下降", "business.efficiency_loss"),
            ("partial", "部分业务停止", "business.partial_outage"),
            ("core", "核心业务停止", "business.core_outage"),
            UNKNOWN,
        ),
        details_when="known",
        fields=[field("impact", "影响说明")],
    ),
    question(
        "BIZ-02",
        2,
        "业务最长可以接受多长时间的系统中断？",
        "duration",
        options(
            ("duration", "填写时长", "continuity.outage_tolerated"),
            ("none", "不可中断", "continuity.no_outage_tolerance"),
            UNKNOWN,
        ),
    ),
    question(
        "BIZ-03",
        2,
        "是否有人工替代流程？",
        choices=options(
            ("full", "可完全替代", "continuity.full_manual_fallback"),
            ("partial", "可部分替代", "continuity.partial_manual_fallback"),
            ("none", "无", "continuity.no_manual_fallback"),
            UNKNOWN,
        ),
    ),
    question(
        "BIZ-04",
        2,
        "人工替代流程如何执行？",
        "object",
        PROVIDED,
        when={"BIZ-03": ["full", "partial"]},
        details_when=["provided"],
        fields=[
            field("coverage", "覆盖范围"),
            field("startup", "启动时间"),
            field("duration", "可持续时间"),
            field("owner", "责任角色"),
        ],
    ),
    question(
        "INT-01",
        3,
        "是否与其他系统交互？",
        choices=yes_no("integration.connected", "integration.isolated"),
    ),
    question(
        "INT-02",
        3,
        "与哪些系统交互？",
        "records",
        PROVIDED,
        when={"INT-01": ["yes"]},
        details_when=["provided"],
        fields=[
            field("name", "系统名称"),
            field(
                "ownership",
                "系统归属",
                options(
                    ("internal", "内部", "integration.internal"),
                    ("third_party", "第三方", "integration.third_party"),
                    UNKNOWN,
                ),
            ),
            field(
                "direction",
                "交互方向",
                options(
                    ("inbound", "输入", "integration.inbound"),
                    ("outbound", "输出", "integration.outbound"),
                    ("both", "双向", "integration.bidirectional"),
                    UNKNOWN,
                ),
            ),
            field(
                "method",
                "交互方式",
                options(
                    ("api", "接口", "integration.api"),
                    ("file", "文件", "integration.file"),
                    ("other", "其他", "integration.other"),
                    UNKNOWN,
                ),
            ),
            field("categories", "数据类别"),
        ],
    ),
]


def tag_dictionary():
    result = {}
    for q in QUESTIONS:
        sources = [(q["title"], q["options"])]
        sources += [(f["label"], f["options"] or []) for f in q["fields"]]
        for title, choices in sources:
            for choice in choices:
                if choice["tag"]:
                    result[choice["tag"]] = f"{title} · {choice['label']}"
    return result


def schema():
    from .. import methodology
    if not methodology.LEGACY_FIXTURES_ENABLED:
        return {'questionnaire_version': QUESTIONNAIRE_VERSION, 'mapping_version': MAPPING_VERSION,
                'groups': [], 'questions': [], 'tags': {}}
    return {
        "questionnaire_version": QUESTIONNAIRE_VERSION,
        "mapping_version": MAPPING_VERSION,
        "groups": GROUPS,
        "questions": QUESTIONS,
        "tags": tag_dictionary(),
    }


EN_TITLES = [
    'Does the system have an entry point accessible over the internet?',
    'Where will the system be deployed?', 'In which countries or regions is each deployment located?',
    'Does the system collect, store, use or transmit personal information?',
    'What types of personal information are involved?', 'Is sensitive personal information involved?',
    'What types of sensitive personal information are involved?',
    'Is personal information processed by another organization on your behalf?',
    'Is personal information provided to other independent processors?',
    'Is personal information publicly disclosed?', 'Is personal information used for automated decisions?',
    'Are there cross-border data arrangements?', 'Which cross-border arrangements apply?',
    'How would a system outage affect the business?', 'What is the longest acceptable outage?',
    'Is a manual fallback available?', 'How does the manual fallback work?',
    'Does this system interact with other systems?', 'Which systems does it interact with?',
]
EN_OPTIONS = {
    'yes': 'Yes', 'no': 'No', 'unknown': 'To be confirmed', 'provided': 'Provide details',
    'public_cloud': 'Public cloud', 'vendor_dc': 'Supplier data center', 'own_dc': 'Own data center',
    'other': 'Other', 'name': 'Name', 'contact': 'Contact details', 'identity': 'Identity information',
    'account': 'Account information', 'biometric': 'Biometrics', 'religion': 'Religious beliefs',
    'health': 'Health information', 'finance': 'Financial accounts', 'location': 'Location history',
    'children': 'Personal information of children under 14', 'storage': 'Overseas storage',
    'transfer': 'Cross-border transmission', 'access': 'Overseas remote access',
    'none': 'None', 'efficiency': 'Reduced efficiency', 'partial': 'Partial', 'core': 'Core business stops',
    'duration': 'Specify duration', 'full': 'Full fallback', 'internal': 'Internal',
    'third_party': 'Third party', 'inbound': 'Inbound', 'outbound': 'Outbound', 'both': 'Bidirectional',
    'api': 'API', 'file': 'File',
}
EN_FIELDS = {'region': 'Country or region', 'provider': 'Provider (optional)', 'party': 'Recipient / processor',
             'purpose': 'Purpose', 'categories': 'Data categories', 'impact': 'Impact description',
             'coverage': 'Coverage', 'startup': 'Startup time', 'duration': 'Sustainable duration',
             'owner': 'Responsible role', 'name': 'System name', 'ownership': 'Ownership',
             'direction': 'Direction', 'method': 'Method'}
for _q, _title in zip(QUESTIONS, EN_TITLES):
    _q['title_en'] = _title
    for _option in _q['options']:
        _option['label_en'] = EN_OPTIONS[_option['value']]
    for _field in _q['fields']:
        _field['label_en'] = EN_FIELDS[_field['key']]
        for _option in _field['options'] or []:
            _option['label_en'] = EN_OPTIONS[_option['value']]
