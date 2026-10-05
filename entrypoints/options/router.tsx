import { createHashRouter, Navigate, RouterProvider } from 'react-router';
import { OptionsLayout } from './layout/OptionsLayout';
import { GeneralPage } from './pages/GeneralPage';
import { CreateModelPage } from './pages/models/CreateModelPage';
import { EditModelPage } from './pages/models/EditModelPage';
import { ModelsListPage } from './pages/models/ModelsListPage';
import { ModelsPage } from './pages/models/ModelsPage';
import { CreatePromptPage } from './pages/prompts/CreatePromptPage';
import { EditPromptPage } from './pages/prompts/EditPromptPage';
import { PromptsListPage } from './pages/prompts/PromptsListPage';
import { PromptsPage } from './pages/prompts/PromptsPage';

const optionsRouter = createHashRouter([
  {
    path: '/',
    Component: OptionsLayout,
    children: [
      {
        index: true,
        element: <Navigate to="/general" replace />,
      },
      {
        path: 'general',
        Component: GeneralPage,
      },
      {
        path: 'models',
        Component: ModelsPage,
        children: [
          {
            index: true,
            Component: ModelsListPage,
          },
          {
            path: 'create',
            Component: CreateModelPage,
          },
          {
            path: 'edit',
            Component: EditModelPage,
          },
        ],
      },
      {
        path: 'prompts',
        Component: PromptsPage,
        children: [
          {
            index: true,
            Component: PromptsListPage,
          },
          {
            path: 'create',
            Component: CreatePromptPage,
          },
          {
            path: 'edit',
            Component: EditPromptPage,
          },
        ],
      },
      // Without a catch-all, a hand-typed or stale hash (e.g. an edit link for
      // a deleted model) dropped the user on React Router's default error
      // screen with no way back. Send unknown routes to the default page.
      {
        path: '*',
        element: <Navigate to="/general" replace />,
      },
    ],
  },
]);

export function OptionsRouter() {
  return <RouterProvider router={optionsRouter} />;
}
