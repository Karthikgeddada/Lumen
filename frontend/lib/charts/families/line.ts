// Lazy family chunk (Apache ECharts — Apache-2.0): registers the modules
// line-family charts need. Loaded on demand by components/Chart.tsx only
// when a line/step-line/area/sparkline chart actually renders; echarts.use
// is idempotent so repeated loads are safe.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  TitleComponent,
  CanvasRenderer,
]);
