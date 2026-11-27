// Lazy family chunk: treemap / sunburst / sankey / tree.
import * as echarts from 'echarts/core';
import { SankeyChart, SunburstChart, TreemapChart, TreeChart } from 'echarts/charts';
import { LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  TreemapChart,
  SunburstChart,
  SankeyChart,
  TreeChart,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);
