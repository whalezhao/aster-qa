import { useEffect } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import ReleaseNotesList from '../components/ReleaseNotesList';
import { LATEST_RELEASE_VERSION, RELEASE_NOTES } from '../releaseNotes';
import { setSeenReleaseVersion } from '../storage';
import { t } from '../i18n';

export default function ReleaseNotes() {
  // 直接打开历史页也算已读；顶栏通过 storage 事件同步隐藏红点
  useEffect(() => {
    setSeenReleaseVersion(LATEST_RELEASE_VERSION);
  }, []);

  return (
    <PageContainer
      ghost
      header={{ title: t('版本公告'), subTitle: t('每次发布的新功能、优化与修复') }}
    >
      <ReleaseNotesList notes={RELEASE_NOTES} />
    </PageContainer>
  );
}