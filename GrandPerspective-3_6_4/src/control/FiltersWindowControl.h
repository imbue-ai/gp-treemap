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

#import <Cocoa/Cocoa.h>

@class FilterRepository;
@class FilterEditor;

@interface FiltersWindowControl : NSWindowController <NSTableViewDataSource, NSTableViewDelegate> {

  IBOutlet NSButton  *editFilterButton;
  IBOutlet NSButton  *removeFilterButton;

  IBOutlet NSTableView  *filterView;
  
  FilterRepository  *filterRepository;
  
  FilterEditor  *filterEditor;
  
  // The data in the table view (names of the filters as NSString)
  NSMutableArray  *filterNames;

  // Non-localized name of filter to select.
  NSString  *filterNameToSelect;
}

// Override designated initialisers
- (instancetype) initWithWindow:(NSWindow *)window NS_UNAVAILABLE;
- (instancetype) initWithCoder:(NSCoder *)coder NS_UNAVAILABLE;

- (instancetype) init;
- (instancetype) initWithFilterRepository:(FilterRepository *)filterRepository NS_DESIGNATED_INITIALIZER;

- (IBAction) okAction:(id)sender;

- (IBAction) addFilterToRepository:(id)sender;
- (IBAction) editFilterInRepository:(id)sender;
- (IBAction) removeFilterFromRepository:(id)sender;

@end // @interface EditFiltersWindowControl
