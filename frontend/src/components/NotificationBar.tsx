import { Badge, Button, Empty, List, Popover, Typography } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../state/NotificationsContext";

export default function NotificationBar() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { unreadCount, notifications, markAllRead } = useNotifications();

  const content = (
    <div className="notification-card notification-popover">
      <div className="notification-popover-head">
        <Typography.Text strong>Notifications</Typography.Text>
        <Button
          type="link"
          size="small"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            markAllRead();
            setOpen(false);
          }}
        >
          Mark all read
        </Button>
      </div>
      {notifications.length === 0 ? (
        <Empty description="No pending requests" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          size="small"
          dataSource={notifications}
          renderItem={(n) => (
            <List.Item
              className="notification-item"
              onClick={() => {
                markAllRead();
                setOpen(false);
                navigate(n.route);
              }}
            >
              <div>
                <Typography.Text strong>{n.title}</Typography.Text>
                <div className="notification-sub">{n.description}</div>
                <div className="notification-time">{new Date(n.created_at).toLocaleString()}</div>
              </div>
            </List.Item>
          )}
        />
      )}
    </div>
  );

  return (
    <div className="notification-wrapper">
      <Popover 
        trigger="click" 
        placement="bottomRight" 
        content={content}
        open={open}
        onOpenChange={setOpen}
        overlayClassName="mobile-notification-popover"
        rootClassName="notification-popover-root"
        autoAdjustOverflow
        showArrow
      >
        <Badge count={unreadCount} size="small">
          <Button
            type="text"
            icon={<BellOutlined />}
            aria-label="Open notifications"
            className={`motion-icon-btn notification-btn ${unreadCount > 0 ? "motion-icon-btn--active" : ""}`}
          />
        </Badge>
      </Popover>
    </div>
  );
}
