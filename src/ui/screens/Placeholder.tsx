/**
 * 未実装ルートの「準備中」画面。
 */
import { Button, Card, Icon } from '../components';
import { href } from '../router';

export function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div class="placeholder">
      <Card class="placeholder__card">
        <Icon name="pen" size={32} class="placeholder__icon" />
        <span class="label label--accent">準備中</span>
        <h1 class="placeholder__title">{title}</h1>
        <p class="muted">{body}</p>
        <Button variant="primary" href={href.home()}>
          ホームへ
        </Button>
      </Card>
    </div>
  );
}
