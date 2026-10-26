import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import mockDataJson from '../data/mockData.json';

interface MockData {
  meta: any;
  map_config: any;
  overview: any;
  charts: any;
  priority_queue: any;
  reports: any;
  map_reports: any;
}

const mockData: MockData = mockDataJson as MockData;

function makeResponse<T>(data: T, config: any, status = 200, statusText = 'OK'): AxiosResponse<T> {
  return {
    data,
    status,
    statusText,
    headers: {},
    config,
  };
}

export function handleMockFallback(config: AxiosRequestConfig): AxiosResponse | null {
  const url = config.url ?? '';
  const method = (config.method ?? 'get').toLowerCase();

  // /meta/options
  if (url.includes('/meta/options')) {
    return makeResponse(mockData.meta, config);
  }

  // /map/config
  if (url.includes('/map/config')) {
    return makeResponse(mockData.map_config, config);
  }

  // /map/reports
  if (url.includes('/map/reports')) {
    return makeResponse(mockData.map_reports, config);
  }

  // /analytics/overview
  if (url.includes('/analytics/overview')) {
    return makeResponse(mockData.overview, config);
  }

  // /analytics/charts
  if (url.includes('/analytics/charts')) {
    return makeResponse(mockData.charts, config);
  }

  // /analytics/priority-queue
  if (url.includes('/analytics/priority-queue')) {
    return makeResponse(mockData.priority_queue, config);
  }

  // /auth/login
  if (url.includes('/auth/login') && method === 'post') {
    let email = 'admin@demo.local';
    try {
      if (typeof config.data === 'string') {
        const parsed = JSON.parse(config.data);
        if (parsed.email) email = parsed.email;
      } else if (config.data?.email) {
        email = config.data.email;
      }
    } catch {
      // fallback to default
    }
    const role = email.includes('admin') ? 'admin' : (email.includes('reviewer') ? 'reviewer' : 'citizen');
    const user = {
      id: 'demo-' + role,
      name: role.charAt(0).toUpperCase() + role.slice(1) + ' (Demo)',
      email,
      role,
      created_at: new Date().toISOString(),
    };
    return makeResponse(
      {
        access_token: 'demo-jwt-token-for-preview',
        token_type: 'bearer',
        user,
      },
      config,
    );
  }

  // /auth/me
  if (url.includes('/auth/me')) {
    return makeResponse(
      {
        id: 'demo-admin',
        name: 'Admin (Demo Mode)',
        email: 'admin@demo.local',
        role: 'admin',
        created_at: new Date().toISOString(),
      },
      config,
    );
  }

  // /detection/analyze
  if (url.includes('/detection/analyze') && method === 'post') {
    return makeResponse(
      {
        detections: [
          {
            class_id: 3,
            class_label: 'Pothole',
            category: 'pothole',
            confidence: 0.91,
            bbox: [180.0, 220.0, 520.0, 580.0],
          },
          {
            class_id: 0,
            class_label: 'Longitudinal Crack',
            category: 'longitudinal_crack',
            confidence: 0.78,
            bbox: [540.0, 160.0, 710.0, 440.0],
          },
        ],
        top_confidence: 0.91,
        dominant_category: 'pothole',
        recommended_severity: 'high',
        latency_ms: 224.5,
        model_version: 'pothole-yolov8s-community-v1',
        model_name: 'YOLOv8 Road Distress Detector',
        image_width: 800,
        image_height: 600,
        class_labels: {
          '0': 'Longitudinal Crack',
          '1': 'Transverse Crack',
          '2': 'Alligator Crack',
          '3': 'Pothole',
          '4': 'Other',
        },
      },
      config,
    );
  }

  // /reports list or single report
  if (url.includes('/reports')) {
    // Single report /reports/{id}
    const match = url.match(/\/reports\/([a-zA-Z0-9_-]+)/);
    if (match && match[1] && !['duplicates', 'history', 'priority'].some((k) => match[1].includes(k))) {
      const id = match[1];
      const items = mockData.reports?.items ?? [];
      const found = items.find((r: any) => r.id === id) || items[0];
      if (found) {
        const detail = {
          ...found,
          images: found.images || [
            {
              id: 'img-demo-01',
              image_type: 'original',
              storage_path: 'docs/assets/pothole_detection_demo.jpg',
              original_filename: 'urban_pothole.jpg',
              file_size_bytes: 455921,
              mime_type: 'image/jpeg',
              is_primary: true,
              detections: [
                {
                  class_label: 'Pothole',
                  category: 'pothole',
                  confidence: 0.88,
                  bbox: [440, 528, 593, 695],
                },
              ],
            },
          ],
          detections: [
            {
              id: 'det-demo-01',
              category: found.category || 'pothole',
              class_label: 'Pothole',
              confidence: 0.88,
              bbox_x: 440,
              bbox_y: 528,
              bbox_w: 153,
              bbox_h: 167,
              model_version: 'pothole-yolov8s-community-v1',
            },
          ],
          history: [
            {
              id: 'hist-01',
              from_status: 'submitted',
              to_status: found.status || 'in_review',
              action: 'Status updated by demo workflow',
              actor_label: 'Priya Shah (Reviewer)',
              created_at: found.created_at || new Date().toISOString(),
            },
          ],
        };
        return makeResponse(detail, config);
      }
    }

    // List reports
    if (method === 'get') {
      return makeResponse(mockData.reports, config);
    }

    // Create report POST
    if (method === 'post') {
      const newReport = {
        id: 'rep-' + Date.now().toString(36),
        reference: 'RG-DEMO-' + Math.floor(1000 + Math.random() * 9000),
        title: 'Reported Road Damage',
        description: 'Citizen report captured via RoadGuard demo',
        category: 'pothole',
        severity: 'high',
        status: 'submitted',
        latitude: 23.0225,
        longitude: 72.5714,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        images: [],
        detections: [],
        history: [],
      };
      return makeResponse(newReport, config, 201, 'Created');
    }
  }

  return null;
}
