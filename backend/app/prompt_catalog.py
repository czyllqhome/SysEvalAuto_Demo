"""Prompt applicability for the current workspace; historical settings stay intact."""
from .narrative import TOPIC_GUIDANCE


def catalog():
    from .ai import default_instruction
    from .delivery_ai import PROMPT as DELIVERY_PROMPT

    def item(key, status, group, zh, en, usage_zh, usage_en, **extra):
        return {'key': key, 'status': status, 'group': group,
                'title': {'zh': zh, 'en': en}, 'usage': {'zh': usage_zh, 'en': usage_en}, **extra}

    items = [
        item('prd_generation', 'active', 'generation', 'PRD 生成', 'PRD generation',
             '控制范围确认后的 PRD 生成', 'Generate a PRD after control scope confirmation'),
        item('narrative_refinement:mlps_purpose', 'active', 'intake', '建设目的优化', 'Refine system purpose',
             '系统信息收集 · A04 建设目的', 'System information · A04 system purpose'),
        item('narrative_refinement:mlps_functions', 'active', 'intake', '业务功能优化', 'Refine business functions',
             '系统信息收集 · A05 业务功能', 'System information · A05 business functions'),
        item('narrative_refinement:mlps_scenarios', 'active', 'intake', '使用场景优化', 'Refine usage scenarios',
             '系统信息收集 · A06 使用场景', 'System information · A06 usage scenarios'),
        item('impact_analysis', 'active', 'review', '供应商整轮影响分析', 'Supplier round impact analysis',
             '复核结果 · 显式发起后续 AI 审查', 'Review results · explicitly requested AI review'),
        item('requirement_risk', 'system', 'review', '单项残余风险分析', 'Single-item residual risk',
             '复核结果 · 单条 AI 风险辅助', 'Review results · single-item AI advice',
             instruction=default_instruction('requirement_risk', 'en').replace('in English,', 'in {language},')),
        item('delivery_evidence', 'system', 'delivery', '交付证据评估', 'Delivery evidence assessment',
             '开发进度追踪 · 已提交证据的 AI 辅助评估', 'Development tracking · AI assessment of submitted evidence',
             instruction=default_instruction('delivery_evidence', 'en').replace('in English,', 'in {language},') + DELIVERY_PROMPT),
        item('context_organization', 'legacy', 'legacy', '应用说明整理', 'Organize application brief',
             '独立应用说明页已退役，当前信息确认直接建立说明', 'The separate brief page is retired; information confirmation now creates the brief'),
        item('prd_import_extraction', 'legacy', 'legacy', 'PRD 导入提取', 'Extract imported PRD',
             '原描述录入页的导入入口已退役', 'The import entry on the former description page is retired'),
        item('narrative_refinement:function_expansion', 'legacy', 'legacy', 'PRD 初稿功能扩写', 'Expand draft PRD functions',
             '独立 PRD 初稿编辑页已退役', 'The separate draft PRD editor is retired'),
        item('narrative_refinement:mlps_description', 'legacy', 'legacy', '综合系统描述优化', 'Refine combined system description',
             '原综合描述已拆分为建设目的、业务功能、使用场景', 'The combined description was split into purpose, functions and scenarios'),
    ]
    labels = {
        'goal': ('建设目标', 'Goals'), 'functions': ('功能范围', 'Functions'),
        'people': ('用户与部门', 'People'), 'responsibility': ('职责分工', 'Responsibilities'),
        'workflow': ('业务流程', 'Workflow'), 'data': ('数据与接口', 'Data and interfaces'),
        'constraints': ('约束条件', 'Constraints'), 'acceptance': ('验收标准', 'Acceptance'),
    }
    for key in TOPIC_GUIDANCE:
        if key in labels:
            zh, en = labels[key]
            items.append(item(f'narrative_refinement:{key}', 'legacy', 'legacy',
                              f'旧描述优化 · {zh}', f'Legacy refinement · {en}',
                              '原八主题描述录入页已退役，历史任务仍保留原配置',
                              'The eight-topic description page is retired; historical jobs retain their configuration'))
    return items
