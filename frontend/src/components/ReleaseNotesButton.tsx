import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Drawer, Space, Typography } from 'antd';
import { NotificationOutlined } from '@ant-design/icons';
import ReleaseNotesList from './ReleaseNotesList';
import { LATEST_RELEASE_VERSION, RELEASE_NOTES } from '../releaseNotes';
import {
  RELEASE_SEEN_EVENT,
  getSeenReleaseVersion,
  setSeenReleaseVersion,
} from '../storage';
import { t } from '../i18n';

export default function ReleaseNotesButton() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | null>(() => getSeenReleaseVersion());

  useEffect(() => {
    const sync = (event: Event) => {
      const version = (event as CustomEvent<string | null>).detail;
      setSeen(version !== undefined ? version : getSeenReleaseVersion());
    };
    window.addEventListener(RELEASE_SEEN_EVENT, sync);
    return () => window.removeEventListener(RELEASE_SEEN_EVENT, sync);
  }, []);

  // 最新公告版本没读过就显示红点；没有公告时不提示
  const unread =
    Boolean(LATEST_RELEASE_VERSION) && seen !== LATEST_RELEASE_VERSION;

  function openNotes() {
    setOpen(true);
    setSeenReleaseVersion(LATEST_RELEASE_VERSION);
  }

  return (
    <>
      <Badge dot={unread} offset={[-2, 4]}>
        <Button
          type="text"
          aria-label={unread ? t('版本公告（有更新）') : t('版本公告')}
          icon={<NotificationOutlined />}
          onClick={openNotes}
        />
      </Badge>
      <Drawer
        title={t('版本公告')}
        placement="right"
        width="min(420px, 100vw)"
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Link to="/release-notes" onClick={() => setOpen(false)}>
              {t('查看全部版本公告')}
            </Link>
            <Typography.Text type="secondary">
              {t('当前版本 {version}', { version: __APP_VERSION__ })}
            </Typography.Text>
          </Space>
        }
      >
        <ReleaseNotesList notes={RELEASE_NOTES.slice(0, 3)} />
      </Drawer>
    </>
  );
}