"""Built-in rules engine — field name → semantic name mapping, basic analysis.

v4.0: Enhanced with comprehensive pattern-based matching and enum suggestions.
"""

import re
from typing import Optional

# ── Field name → Chinese semantic name mapping table ──
# Covers 80%+ of common database field patterns.
FIELD_NAME_MAP: dict[str, str] = {
    # Identity / Primary key
    "id": "主键ID", "pk": "主键", "primary_key": "主键",
    "uid": "用户ID", "uuid": "唯一标识",
    # Personal info
    "name": "名称", "user_name": "用户名", "username": "用户名",
    "real_name": "真实姓名", "nick_name": "昵称", "nickname": "昵称",
    "display_name": "显示名", "full_name": "全名",
    "first_name": "名", "last_name": "姓",
    "email": "邮箱", "mail": "邮箱",
    "phone": "手机号", "mobile": "手机号", "tel": "电话", "telephone": "电话",
    "address": "地址", "addr": "地址",
    "city": "城市", "province": "省份", "country": "国家",
    "gender": "性别", "sex": "性别", "age": "年龄", "birthday": "生日",
    "avatar": "头像", "photo": "照片", "image": "图片",
    # Status / Type
    "status": "状态", "state": "状态", "type": "类型", "category": "分类",
    "level": "等级", "grade": "等级", "priority": "优先级",
    "is_active": "是否活跃", "is_enabled": "是否启用", "is_deleted": "是否删除",
    "is_default": "是否默认", "is_locked": "是否锁定",
    "enabled": "启用状态", "disabled": "禁用状态", "active": "活跃",
    "flag": "标记", "tag": "标签", "tags": "标签",
    # Time
    "created_at": "创建时间", "create_time": "创建时间", "gmt_create": "创建时间",
    "create_date": "创建日期",
    "updated_at": "更新时间", "update_time": "更新时间", "gmt_modified": "修改时间",
    "modify_date": "修改日期",
    "deleted_at": "删除时间", "delete_time": "删除时间",
    "start_time": "开始时间", "end_time": "结束时间",
    "expire_time": "过期时间", "expired_at": "过期时间",
    "login_time": "登录时间", "last_login": "最后登录",
    "created_date": "创建日期", "modified_date": "修改日期",
    # User relations
    "created_by": "创建人", "creator": "创建人",
    "updated_by": "更新人", "modifier": "修改人",
    "operator": "操作人", "owner": "所有者", "assignee": "负责人",
    # Business fields
    "title": "标题", "subject": "主题", "content": "内容",
    "description": "描述", "desc": "描述", "remark": "备注", "note": "备注",
    "comment": "备注", "message": "消息", "body": "正文",
    "code": "编码", "serial_no": "序列号", "order_no": "订单号",
    "amount": "金额", "price": "价格", "cost": "成本",
    "money": "金额", "fee": "费用",
    "quantity": "数量", "count": "数量", "total": "合计",
    "num": "数量", "number": "数量", "qty": "数量",
    "balance": "余额", "score": "分数", "weight": "权重",
    "sort": "排序", "sort_order": "排序号",
    "version": "版本", "revision": "版本号",
    "url": "链接", "link": "链接", "path": "路径",
    "ip": "IP地址", "ip_address": "IP地址",
    "parent_id": "父级ID", "pid": "父级ID",
    "department": "部门", "dept": "部门", "org": "组织",
    "company": "公司", "organization": "组织",
    "role": "角色", "permission": "权限",
    "password": "密码", "pwd": "密码", "secret": "密钥",
    "token": "令牌", "salt": "盐值",
    "config": "配置", "setting": "设置", "option": "选项",
    "source": "来源", "channel": "渠道", "platform": "平台",
    "region": "区域", "area": "区域", "zone": "分区",
    "longitude": "经度", "latitude": "纬度", "lng": "经度", "lat": "纬度",
    # Additional common words for split matching
    "start": "开始", "end": "结束", "begin": "开始",
    "date": "日期", "time": "时间", "year": "年份", "month": "月份", "day": "日",
    "order": "订单", "user": "用户", "item": "项目", "unit": "单位",
    "trans": "交易", "pay": "支付", "contract": "合同", "treaty": "协议",
    "channel": "渠道", "project": "项目", "task": "任务", "plan": "计划",
    "apply": "申请", "audit": "审核", "check": "检查", "review": "审查",
    "report": "报告", "log": "日志", "record": "记录", "history": "历史",
    "max": "最大", "min": "最小", "avg": "平均",
}

# ── Pattern-based semantic name rules (regex → display_name) ──
# These are checked after exact match fails.
_PATTERN_SEMANTIC_RULES: list[tuple[str, str]] = [
    (r"^(id|pk|primary_key)$", "主键ID"),
    (r"^.*_id$", "ID"),
    (r"^(create_time|created_at|gmt_create|create_date)$", "创建时间"),
    (r"^(update_time|updated_at|gmt_modified|modify_date)$", "修改时间"),
    (r"^.*_(by|person)$", "操作人"),
    (r"^(creator|modifier)$", "操作人"),
    (r"^is_.*$", "布尔标识"),
    (r"^has_.*$", "布尔标识"),
    (r"^(amount|price|money|fee|cost)$", "金额"),
    (r"^(count|num|number|qty|quantity)$", "数量"),
]

# ── Enum suggestion rules ──
# Fields matching these patterns get default enum suggestions.
_ENUM_RULES: list[tuple[str, list[str]]] = [
    (r"^(status|state)$", ["正常", "停用"]),
    (r"^(gender|sex)$", ["男", "女"]),
    (r"^is_.*$", ["是", "否"]),
    (r"^has_.*$", ["是", "否"]),
]

# Patterns for system/readonly fields
_SYSTEM_PATTERNS = [
    r"^id$", r"^pk$", r"^primary_key$",
    r".*_id$",
    r"^(created?|gmt_create|insert)_(at|time|date|by)$",
    r"^(updated?|gmt_modif|modify)_(at|time|date|by)$",
    r"^(deleted?|remove)_(at|time|date)$",
    r"^is_deleted$", r"^version$", r"^revision$",
]

_READONLY_PATTERNS = [
    r"^id$", r"^pk$", r"^primary_key$",
    r".*_id$",
    r"^(created?|gmt_create|create)_(at|time|date)$",
    r"^(updated?|gmt_modif|modify)_(at|time|date)$",
    r"^(created?|updated?)_by$",
    r"^(creator|modifier)$",
]


def suggest_semantic_name(field_name: str) -> Optional[str]:
    """Try to map a field name to a Chinese semantic name using built-in rules."""
    fn = field_name.lower().strip()
    # 1. Exact match
    if fn in FIELD_NAME_MAP:
        return FIELD_NAME_MAP[fn]
    # 2. Try without common prefixes/suffixes
    for prefix in ("t_", "f_", "c_", "sys_", "biz_"):
        if fn.startswith(prefix):
            stripped = fn[len(prefix):]
            if stripped in FIELD_NAME_MAP:
                return FIELD_NAME_MAP[stripped]
    # 3. Pattern-based matching
    for pattern, name in _PATTERN_SEMANTIC_RULES:
        if re.match(pattern, fn):
            return name
    # 4. Split by underscore and translate each part, then combine
    parts = fn.split("_")
    if len(parts) >= 2:
        translated = []
        has_match = False
        for p in parts:
            if p in FIELD_NAME_MAP:
                translated.append(FIELD_NAME_MAP[p])
                has_match = True
            elif p in ("index", "idx"):
                translated.append("索引")
                has_match = True
            elif p in ("info", "detail"):
                translated.append("信息")
                has_match = True
            elif p in ("list", "items"):
                translated.append("列表")
                has_match = True
            elif p in ("no", "sn"):
                translated.append("编号")
                has_match = True
            elif p in ("min", "max", "avg", "sum"):
                translated.append({"min": "最小", "max": "最大", "avg": "平均", "sum": "合计"}[p])
                has_match = True
            else:
                translated.append(p)
        if has_match:
            return "".join(translated)
    return None


def suggest_enum(field_name: str) -> Optional[list[str]]:
    """Suggest enum values based on field name patterns."""
    fn = field_name.lower().strip()
    for pattern, values in _ENUM_RULES:
        if re.match(pattern, fn):
            return values
    return None


def is_system_field(field_name: str) -> bool:
    """Check if a field looks like a system field."""
    fn = field_name.lower().strip()
    return any(re.match(p, fn) for p in _SYSTEM_PATTERNS)


def is_readonly_field(field_name: str) -> bool:
    """Check if a field should be readonly by default."""
    fn = field_name.lower().strip()
    return any(re.match(p, fn) for p in _READONLY_PATTERNS)
