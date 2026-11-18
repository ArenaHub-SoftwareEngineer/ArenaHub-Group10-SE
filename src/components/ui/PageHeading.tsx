import React from 'react';

export function PageHeading({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return <header className={`dashboard-page-heading${actions ? ' with-actions' : ''}`}>
    <div><h1>{title}</h1><p>{description}</p></div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}
