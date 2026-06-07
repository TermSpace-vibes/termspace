import React from 'react'
import { renderToString } from 'react-dom/server'
import { PanelGroup, Panel, Separator } from 'react-resizable-panels'

try {
  const html = renderToString(
    <PanelGroup direction="horizontal">
      <Panel defaultSize={100}>
        <div>Hello</div>
      </Panel>
    </PanelGroup>
  )
  console.log("SUCCESS")
} catch (err) {
  console.error("ERROR", err)
}
