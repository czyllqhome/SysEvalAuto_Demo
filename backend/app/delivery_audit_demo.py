"""Build a scoped, factual audit-log excerpt for an editable delivery draft."""
import base64
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select

from .db import Audit, User
from .domain import DomainError


def preview(db, batch, item, language='zh'):
    requirement = item.snapshot.get('requirement', {})
    title = requirement.get('title', '')
    if title.strip() != '安全审计' and title.strip().casefold() != 'security audit':
        raise DomainError('INVALID_FIELDS')
    rows = list(db.execute(select(Audit, User.role).outerjoin(User, User.id == Audit.actor_id).where(
        Audit.system_id == batch.system_id, Audit.action.in_([
            'supplier.submitted', 'report.reviewed', 'negotiation.opened', 'baseline.frozen',
            'baseline.confirmed', 'baseline.finalized', 'delivery.initialized'])).order_by(
                Audit.created_at.desc(), Audit.id).limit(10)))
    if not rows:
        raise DomainError('REVIEW_INCOMPLETE')
    zone = timezone(timedelta(hours=8))
    dates = [datetime.fromtimestamp(event.created_at, zone).strftime('%Y-%m-%d %H:%M:%S') for event, _ in rows]
    fonts = [Path('C:/Windows/Fonts/consola.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')]
    font_path = next((p for p in fonts if p.is_file()), None)
    font = ImageFont.truetype(str(font_path), 19) if font_path else ImageFont.load_default(size=19)
    image = Image.new('RGB', (1320, 190 + len(rows) * 48), '#f3f6fa')
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1320, 100), fill='#20344e')
    draw.text((30, 23), 'SYSTEM SECURITY AUDIT | Recorded event excerpt', font=font, fill='white')
    draw.text((30, 58), 'Timezone: UTC+08:00 | Actors shown by role | Sensitive details omitted', font=font, fill='#bacce0')
    draw.text((30, 120), 'Recorded at                 Actor role       Event                         Reference', font=font, fill='#354e6a')
    for index, ((event, role), date) in enumerate(zip(rows, dates, strict=True)):
        y = 157 + index * 48
        draw.rectangle((20, y-6, 1300, y+35), fill='white' if index % 2 == 0 else '#eaf0f7')
        actor = 'supplier' if role == 'vendor' else 'customer' if role else 'system'
        draw.text((30, y), f'{date}         {actor:12}     {event.action:28}  {event.id[:8]}', font=font, fill='#253b53')
    output = BytesIO()
    image.save(output, format='PNG')
    start, finish = min(dates), max(dates)
    zh = language == 'zh'
    description = (f'系统安全审计记录已覆盖供应商答复提交、负责人处理及基线确认等关键业务操作。\n'
                   f'附件为本系统真实审计日志摘录，记录时间范围为 {start} 至 {finish}（北京时间），共 {len(rows)} 条。'
                   '截图展示记录时间、操作角色和事件名称；操作人以角色显示，未包含账号、凭据或业务正文。\n'
                   '核验方式：对照供应商提交、负责人处理和双方确认记录，检查事件顺序与角色对应关系。'
                   '本材料仅证明所摘录操作存在审计记录；全用户覆盖、日志留存周期、防篡改和异常告警仍需补充配置及测试证据。'
                   if zh else f'The system records key supplier, customer review and baseline events.\n'
                   f'The attached actual audit excerpt contains {len(rows)} records from {start} to {finish} (UTC+08:00). '
                   'It shows timestamps, actor roles and event names, omitting accounts, credentials and business text.\n'
                   'Compare the sequence and roles with submission, review and joint confirmation records. '
                   'This excerpt proves only the recorded events. Coverage of every user, retention, tamper protection and alerts require further configuration and test evidence.')
    return {'filename': 'security-audit-log.png', 'image_base64': base64.b64encode(output.getvalue()).decode(),
            'draft': {'description': description, 'environment': '本地运行环境' if zh else 'Local runtime',
                      'system_version': 'v0.1', 'collected_on': datetime.now(zone).date().isoformat()}}
