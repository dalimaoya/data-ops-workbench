import { useState, useEffect } from 'react';
import {
  Table, Card, Button, Space, Tag, Modal, Form, Input, Select, message, Popconfirm,
  Checkbox, Spin,
} from 'antd';
import {
  PlusOutlined, EditOutlined, LockOutlined, StopOutlined, CheckCircleOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import {
  listUsers, createUser, updateUser, updateUserStatus, resetUserPassword,
  getUserDatasourcePermissions, setUserDatasourcePermissions,
} from '../../api/users';
import type { UserItem } from '../../api/users';
import { formatBeijingTime } from '../../utils/formatTime';
import { useTranslation } from 'react-i18next';

export default function UserManagement() {
  const { t } = useTranslation();

  const roleOptions = [
    { label: t('role.admin'), value: 'admin' },
    { label: t('role.operator'), value: 'operator' },
    { label: t('role.readonly'), value: 'readonly' },
  ];

  const roleLabels: Record<string, string> = {
    admin: t('role.admin'),
    operator: t('role.operator'),
    readonly: t('role.readonly'),
  };

  const roleColors: Record<string, string> = {
    admin: 'red',
    operator: 'blue',
    readonly: 'default',
  };

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [createLoading, setCreateLoading] = useState(false);

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [editLoading, setEditLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);

  // Reset password modal
  const [resetOpen, setResetOpen] = useState(false);
  const [resetForm] = Form.useForm();
  const [resetLoading, setResetLoading] = useState(false);
  const [resetUser, setResetUser] = useState<UserItem | null>(null);

  // Datasource permission modal (v2.2)
  const [permOpen, setPermOpen] = useState(false);
  const [permLoading, setPermLoading] = useState(false);
  const [permSaveLoading, setPermSaveLoading] = useState(false);
  const [permUser, setPermUser] = useState<UserItem | null>(null);
  const [allDatasources, setAllDatasources] = useState<{ id: number; datasource_name: string; db_type: string }[]>([]);
  const [selectedDsIds, setSelectedDsIds] = useState<number[]>([]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await listUsers();
      setUsers(res.data);
    } catch {
      message.error(t('userManagement.listFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      await createUser(values);
      message.success(t('userManagement.createSuccess'));
      setCreateOpen(false);
      createForm.resetFields();
      fetchUsers();
    } catch (err: any) {
      if (err?.response?.data?.detail) {
        message.error(err.response.data.detail);
      }
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!editingUser) return;
    try {
      const values = await editForm.validateFields();
      setEditLoading(true);
      await updateUser(editingUser.id, values);
      message.success(t('userManagement.updateSuccess'));
      setEditOpen(false);
      editForm.resetFields();
      setEditingUser(null);
      fetchUsers();
    } catch (err: any) {
      if (err?.response?.data?.detail) {
        message.error(err.response.data.detail);
      }
    } finally {
      setEditLoading(false);
    }
  };

  const handleToggleStatus = async (record: UserItem) => {
    const newStatus = record.status === 'enabled' ? 'disabled' : 'enabled';
    try {
      await updateUserStatus(record.id, newStatus);
      message.success(newStatus === 'enabled' ? t('userManagement.enabledSuccess') : t('userManagement.disabledSuccess'));
      fetchUsers();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('common.failed'));
    }
  };

  const handleResetPassword = async () => {
    if (!resetUser) return;
    try {
      const values = await resetForm.validateFields();
      setResetLoading(true);
      await resetUserPassword(resetUser.id, values.new_password);
      message.success(t('userManagement.resetSuccess'));
      setResetOpen(false);
      resetForm.resetFields();
      setResetUser(null);
    } catch (err: any) {
      if (err?.response?.data?.detail) {
        message.error(err.response.data.detail);
      }
    } finally {
      setResetLoading(false);
    }
  };

  const handleOpenPermissions = async (record: UserItem) => {
    setPermUser(record);
    setPermOpen(true);
    setPermLoading(true);
    try {
      const res = await getUserDatasourcePermissions(record.id);
      setAllDatasources(res.data.all_datasources);
      setSelectedDsIds(res.data.datasource_ids);
    } catch {
      message.error(t('userManagement.permLoadFailed'));
    } finally {
      setPermLoading(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!permUser) return;
    setPermSaveLoading(true);
    try {
      await setUserDatasourcePermissions(permUser.id, selectedDsIds);
      message.success(t('userManagement.permUpdateSuccess'));
      setPermOpen(false);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('common.failed'));
    } finally {
      setPermSaveLoading(false);
    }
  };

  const columns = [
    { title: t('userManagement.username'), dataIndex: 'username', key: 'username', width: 120 },
    { title: t('userManagement.displayName'), dataIndex: 'display_name', key: 'display_name', width: 120 },
    {
      title: t('userManagement.roleLabel'), dataIndex: 'role', key: 'role', width: 100,
      render: (role: string) => (
        <Tag color={roleColors[role] || 'default'}>{roleLabels[role] || role}</Tag>
      ),
    },
    {
      title: t('common.status'), dataIndex: 'status', key: 'status', width: 80,
      render: (status: string) => (
        <Tag color={status === 'enabled' ? 'green' : 'red'}>
          {status === 'enabled' ? t('userManagement.statusNormal') : t('userManagement.statusDisabled')}
        </Tag>
      ),
    },
    {
      title: t('userManagement.createdAt'), dataIndex: 'created_at', key: 'created_at', width: 180,
      render: (val: string) => formatBeijingTime(val),
    },
    {
      title: t('common.operation'), key: 'action', width: 340,
      render: (_: unknown, record: UserItem) => (
        <Space size="small" wrap>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingUser(record);
              editForm.setFieldsValue({
                display_name: record.display_name,
                role: record.role,
              });
              setEditOpen(true);
            }}
          >
            {t('common.edit')}
          </Button>
          <Button
            size="small"
            icon={<DatabaseOutlined />}
            onClick={() => handleOpenPermissions(record)}
          >
            {t('userManagement.datasourcePermission')}
          </Button>
          <Button
            size="small"
            icon={<LockOutlined />}
            onClick={() => {
              setResetUser(record);
              setResetOpen(true);
            }}
          >
            {t('userManagement.resetPassword')}
          </Button>
          {record.username !== 'admin' && (
            <Popconfirm
              title={record.status === 'enabled' ? t('userManagement.confirmDisable') : t('userManagement.confirmEnable')}
              onConfirm={() => handleToggleStatus(record)}
            >
              <Button
                size="small"
                danger={record.status === 'enabled'}
                icon={record.status === 'enabled' ? <StopOutlined /> : <CheckCircleOutlined />}
              >
                {record.status === 'enabled' ? t('common.disable') : t('common.enable')}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={t('userManagement.title')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t('userManagement.createUser')}
          </Button>
        }
      >
        <Table
          dataSource={users}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
        />
      </Card>

      {/* Create user modal */}
      <Modal
        title={t('userManagement.createUser')}
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        confirmLoading={createLoading}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="username" label={t('userManagement.username')} rules={[{ required: true, message: t('userManagement.usernameRequired') }]}>
            <Input placeholder={t('userManagement.usernamePlaceholder')} />
          </Form.Item>
          <Form.Item name="display_name" label={t('userManagement.displayName')}>
            <Input placeholder={t('userManagement.displayNamePlaceholder')} />
          </Form.Item>
          <Form.Item name="password" label={t('userManagement.passwordLabel')} rules={[{ required: true, message: t('userManagement.passwordRequired') }, { min: 4, message: t('userManagement.passwordMinLength') }]}>
            <Input.Password placeholder={t('userManagement.passwordPlaceholder')} />
          </Form.Item>
          <Form.Item name="role" label={t('userManagement.roleLabel')} rules={[{ required: true, message: t('userManagement.roleRequired') }]}>
            <Select options={roleOptions} placeholder={t('userManagement.rolePlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit user modal */}
      <Modal
        title={`${t('userManagement.editUser')} - ${editingUser?.username || ''}`}
        open={editOpen}
        onOk={handleEdit}
        onCancel={() => { setEditOpen(false); editForm.resetFields(); setEditingUser(null); }}
        confirmLoading={editLoading}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="display_name" label={t('userManagement.displayName')}>
            <Input placeholder={t('userManagement.displayNamePlaceholder')} />
          </Form.Item>
          <Form.Item name="role" label={t('userManagement.roleLabel')} rules={[{ required: true, message: t('userManagement.roleRequired') }]}>
            <Select options={roleOptions} placeholder={t('userManagement.rolePlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Reset password modal */}
      <Modal
        title={`${t('userManagement.resetPasswordTitle')} - ${resetUser?.username || ''}`}
        open={resetOpen}
        onOk={handleResetPassword}
        onCancel={() => { setResetOpen(false); resetForm.resetFields(); setResetUser(null); }}
        confirmLoading={resetLoading}
        destroyOnClose
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item
            name="new_password"
            label={t('userManagement.newPassword')}
            rules={[{ required: true, message: t('userManagement.newPasswordRequired') }, { min: 4, message: t('userManagement.passwordMinLength') }]}
          >
            <Input.Password placeholder={t('userManagement.newPasswordPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Datasource permission modal (v2.2) */}
      <Modal
        title={`${t('userManagement.datasourcePermissionTitle')} - ${permUser?.display_name || permUser?.username || ''}`}
        open={permOpen}
        onOk={handleSavePermissions}
        onCancel={() => { setPermOpen(false); setPermUser(null); }}
        confirmLoading={permSaveLoading}
        destroyOnClose
      >
        {permLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <div>
            {permUser?.role === 'admin' && (
              <div style={{ marginBottom: 12, color: '#999' }}>
                {t('userManagement.adminPermHint')}
              </div>
            )}
            <Checkbox.Group
              value={selectedDsIds}
              onChange={(vals) => setSelectedDsIds(vals as number[])}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {allDatasources.map((ds) => (
                <Checkbox key={ds.id} value={ds.id}>
                  {ds.datasource_name}
                  <Tag style={{ marginLeft: 8 }}>{ds.db_type}</Tag>
                </Checkbox>
              ))}
              {allDatasources.length === 0 && (
                <div style={{ color: '#999' }}>{t('userManagement.noDatasource')}</div>
              )}
            </Checkbox.Group>
          </div>
        )}
      </Modal>
    </div>
  );
}
