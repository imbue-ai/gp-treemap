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

#import "DrawTaskExecutor.h"

#import "TreeDrawer.h"
#import "TreeDrawerSettings.h"
#import "DrawTaskInput.h"
#import "TreeContext.h"


@implementation DrawTaskExecutor

- (instancetype) initWithTreeContext:(TreeContext *)treeContextVal {
  return [self initWithTreeContext: treeContextVal 
                   drawingSettings: [[[TreeDrawerSettings alloc] init] autorelease]];
}

- (instancetype) initWithTreeContext:(TreeContext *)treeContextVal
                     drawingSettings:(TreeDrawerSettings *)settings {
  if (self = [super init]) {
    treeContext = [treeContextVal retain];
  
    _treeDrawer = [[TreeDrawer alloc] initWithScanTree: treeContext.scanTree
                                    treeDrawerSettings: settings];
    _treeDrawerSettings = [settings retain];

    settingsLock = [[NSLock alloc] init];
  }
  return self;
}

- (void) dealloc {
  [treeContext release];

  [_treeDrawer release];

  [_treeDrawerSettings release];

  [settingsLock release];
  
  [super dealloc];
}


- (void) setTreeDrawerSettings:(TreeDrawerSettings *)settings {
  [settingsLock lock];
  [_treeDrawerSettings release];
  _treeDrawerSettings = [settings retain];
  [settingsLock unlock];
}


- (void) prepareToRunTask {
  [_treeDrawer clearAbortFlag];
}

- (id) runTaskWithInput:(id)input {
  [settingsLock lock];
  // Even though the settings are immutable, obtaining the settingsLock
  // ensures that it is not de-allocated while it is being used. 
  [_treeDrawer updateSettings: self.treeDrawerSettings];
  [settingsLock unlock];

  DrawTaskInput  *drawingInput = input;
    
  [treeContext obtainReadLock];
    
  NSImage  *image = [_treeDrawer drawImageOfVisibleTree: drawingInput.visibleTree
                                         startingAtTree: drawingInput.treeInView
                                     usingLayoutBuilder: drawingInput.layoutBuilder
                                                 inRect: drawingInput.bounds];

  [treeContext releaseReadLock];

  return image;
}

- (void) abortTask {
  [_treeDrawer abortDrawing];
}

@end
