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

#import "ScanTaskOutput.h"

#import "AlertMessage.h"
#import "TreeContext.h"

@implementation ScanTaskOutput

+ (instancetype) scanTaskOutput:(TreeContext *)treeContext alert:(AlertMessage *)alert {
  return [[[ScanTaskOutput alloc] initWithTreeContext: treeContext alert: alert] autorelease];
}

+ (instancetype) failedScanTaskOutput:(AlertMessage *)alert {
  return [[[ScanTaskOutput alloc] initWithTreeContext: nil alert: alert] autorelease];
}

- (instancetype) initWithTreeContext:(TreeContext *)treeContext alert:(AlertMessage *)alert {
  if (self = [super init]) {
    NSAssert(treeContext != nil || alert != nil, @"treeContext or alert must be set.");

    _treeContext = [treeContext retain];
    _alert = [alert retain];
  }
  return self;
}

- (void) dealloc {
  [_treeContext release];
  [_alert release];

  [super dealloc];
}

@end
