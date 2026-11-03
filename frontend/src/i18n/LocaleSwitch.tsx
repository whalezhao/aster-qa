import { Button, Dropdown } from 'antd';
import { TranslationOutlined } from '@ant-design/icons';
import { useLocale } from './LocaleContext';
import { t, type Locale } from './index';

/** 顶栏/登录页共用的语言切换。circle 用于登录页那种圆形图标按钮。 */
export default function LocaleSwitch({ circle = false }: { circle?: boolean }) {
  const { locale, setLocale } = useLocale();

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        selectable: true,
        selectedKeys: [locale],
        items: [
          { key: 'zh', label: '中文' },
          { key: 'en', label: 'English' },
        ],
        onClick: ({ key }) => setLocale(key as Locale),
      }}
    >
      <Button
        type={circle ? 'default' : 'text'}
        shape={circle ? 'circle' : undefined}
        aria-label={t('切换语言')}
        icon={<TranslationOutlined />}
      >
        {circle ? undefined : locale === 'en' ? 'EN' : '中'}
      </Button>
    </Dropdown>
  );
}