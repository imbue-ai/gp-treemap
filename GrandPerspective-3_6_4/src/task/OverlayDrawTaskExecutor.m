/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "OverlayDrawTaskExecutor.h"

#import "OverlayDrawer.h"
#import "OverlayDrawTaskInput.h"
#import "TreeDrawerBaseSettings.h"

@implementation OverlayDrawTaskExecutor

- (instancetype) initWithScanTree:(DirectoryItem *)scanTree {
  return [self initWithScanTree: scanTree
                 drawingSettings: [[[TreeDrawerBaseSettings alloc] init] autorelease]];
}

- (instancetype) initWithScanTree:(DirectoryItem *)scanTree
                  drawingSettings:(TreeDrawerBaseSettings *)settings {
  if (self = [super init]) {
    overlayDrawer = [[OverlayDrawer alloc] initWithScanTree: scanTree];
    _overlayDrawerSettings = [settings retain];

    settingsLock = [[NSLock alloc] init];
  }
  return self;
}

- (void) dealloc {
  [overlayDrawer release];
  [_overlayDrawerSettings release];
  [settingsLock release];

  [super dealloc];
}


- (void) setOverlayDrawerSettings:(TreeDrawerBaseSettings *)settings {
  [settingsLock lock];
  if (settings != _overlayDrawerSettings) {
    [_overlayDrawerSettings release];
    _overlayDrawerSettings = [settings retain];
  }
  [settingsLock unlock];
}


- (void) prepareToRunTask {
  [overlayDrawer clearAbortFlag];
}

- (id) runTaskWithInput:(id)input {
  [settingsLock lock];
  // Even though the settings are immutable, obtaining the settingsLock
  // ensures that it is not de-allocated while it is being used.
  [overlayDrawer updateSettings: self.overlayDrawerSettings];
  [settingsLock unlock];

  OverlayDrawTaskInput  *overlayInput = input;

  return [overlayDrawer drawOverlayImageOfVisibleTree: overlayInput.visibleTree
                                       startingAtTree: overlayInput.treeInView
                                   usingLayoutBuilder: overlayInput.layoutBuilder
                                               inRect: overlayInput.bounds
                                          overlayTest: overlayInput.overlayTest];
}

- (void) abortTask {
  [overlayDrawer abortDrawing];
}

@end
